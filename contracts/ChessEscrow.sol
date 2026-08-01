// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Holds two equal USDC stakes for a single online chess game and
/// releases the pot once a trusted resolver reports the outcome. The resolver
/// independently replays the game's move log off-chain before calling
/// resolve()/resolveDraw() — this contract only enforces custody and payout,
/// not chess rules. If the resolver never acts, either player can reclaim
/// their own stake after abandonTimeout so funds can never be stuck forever.
contract ChessEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum GameStatus {
        NotCreated,
        WaitingForOpponent,
        Funded,
        Resolved,
        Refunded,
        Cancelled
    }

    struct Game {
        address playerA;
        address playerB;
        uint256 stakeAmount;
        bool depositedA;
        bool depositedB;
        GameStatus status;
        uint256 createdAt;
        uint256 fundedAt;
    }

    address public owner;
    address public resolver;
    IERC20 public immutable usdc;
    uint256 public abandonTimeout = 24 hours;

    mapping(bytes32 => Game) public games;

    event GameCreated(bytes32 indexed gameId, address indexed playerA, uint256 stakeAmount);
    event GameJoined(bytes32 indexed gameId, address indexed playerB);
    event Deposited(bytes32 indexed gameId, address indexed player);
    event GameFunded(bytes32 indexed gameId);
    event GameResolved(bytes32 indexed gameId, address indexed winner, uint256 amount);
    event GameDrawn(bytes32 indexed gameId, uint256 amountEach);
    event GameRefunded(bytes32 indexed gameId);
    event GameCancelled(bytes32 indexed gameId);
    event ResolverUpdated(address indexed newResolver);
    event AbandonTimeoutUpdated(uint256 newTimeout);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyResolver() {
        require(msg.sender == resolver, "not resolver");
        _;
    }

    constructor(address _usdc, address _resolver) {
        require(_usdc != address(0), "usdc=0");
        require(_resolver != address(0), "resolver=0");
        owner = msg.sender;
        usdc = IERC20(_usdc);
        resolver = _resolver;
    }

    /// @notice Starts a game for a given off-chain gameId (e.g. a Firebase room id hashed to bytes32).
    function createGame(bytes32 gameId, uint256 stakeAmount) external {
        require(games[gameId].status == GameStatus.NotCreated, "game exists");
        require(stakeAmount > 0, "stake=0");

        games[gameId] = Game({
            playerA: msg.sender,
            playerB: address(0),
            stakeAmount: stakeAmount,
            depositedA: false,
            depositedB: false,
            status: GameStatus.WaitingForOpponent,
            createdAt: block.timestamp,
            fundedAt: 0
        });

        emit GameCreated(gameId, msg.sender, stakeAmount);
    }

    function joinGame(bytes32 gameId) external {
        Game storage g = games[gameId];
        require(g.status == GameStatus.WaitingForOpponent, "not joinable");
        require(g.playerB == address(0), "already joined");
        require(msg.sender != g.playerA, "cannot join own game");

        g.playerB = msg.sender;
        emit GameJoined(gameId, msg.sender);
    }

    /// @dev Both players deposit the SAME `g.stakeAmount` fixed at createGame time —
    /// there is no separate per-caller amount to compare, so it is structurally
    /// impossible for the two deposits to differ.
    function deposit(bytes32 gameId) external nonReentrant {
        Game storage g = games[gameId];
        require(g.status == GameStatus.WaitingForOpponent, "not fundable");
        require(g.playerB != address(0), "opponent not joined");
        require(msg.sender == g.playerA || msg.sender == g.playerB, "not a player");

        if (msg.sender == g.playerA) {
            require(!g.depositedA, "already deposited");
            g.depositedA = true;
        } else {
            require(!g.depositedB, "already deposited");
            g.depositedB = true;
        }

        usdc.safeTransferFrom(msg.sender, address(this), g.stakeAmount);
        emit Deposited(gameId, msg.sender);

        if (g.depositedA && g.depositedB) {
            g.status = GameStatus.Funded;
            g.fundedAt = block.timestamp;
            emit GameFunded(gameId);
        }
    }

    function resolve(bytes32 gameId, address winner) external onlyResolver nonReentrant {
        Game storage g = games[gameId];
        require(g.status == GameStatus.Funded, "not funded");
        require(winner == g.playerA || winner == g.playerB, "invalid winner");

        uint256 pot = g.stakeAmount * 2;
        g.status = GameStatus.Resolved;
        usdc.safeTransfer(winner, pot);
        emit GameResolved(gameId, winner, pot);
    }

    function resolveDraw(bytes32 gameId) external onlyResolver nonReentrant {
        Game storage g = games[gameId];
        require(g.status == GameStatus.Funded, "not funded");

        uint256 amountEach = g.stakeAmount;
        g.status = GameStatus.Resolved;
        usdc.safeTransfer(g.playerA, amountEach);
        usdc.safeTransfer(g.playerB, amountEach);
        emit GameDrawn(gameId, amountEach);
    }

    /// @notice Escape hatch so a non-cooperating resolver or a disconnected
    /// opponent can never lock funds forever: either player can reclaim their
    /// own stake once abandonTimeout has passed since the game became funded.
    function claimAbandonRefund(bytes32 gameId) external nonReentrant {
        Game storage g = games[gameId];
        require(g.status == GameStatus.Funded, "not funded");
        require(msg.sender == g.playerA || msg.sender == g.playerB, "not a player");
        require(block.timestamp >= g.fundedAt + abandonTimeout, "timeout not reached");

        uint256 amountEach = g.stakeAmount;
        g.status = GameStatus.Refunded;
        usdc.safeTransfer(g.playerA, amountEach);
        usdc.safeTransfer(g.playerB, amountEach);
        emit GameRefunded(gameId);
    }

    /// @notice Lets a creator close out a game nobody joined/funded yet. No
    /// funds are involved at this point since deposit() hasn't happened.
    function cancelUnfundedGame(bytes32 gameId) external {
        Game storage g = games[gameId];
        require(g.status == GameStatus.WaitingForOpponent, "not cancellable");
        require(msg.sender == g.playerA, "not creator");
        require(!g.depositedA && !g.depositedB, "already funded");

        g.status = GameStatus.Cancelled;
        emit GameCancelled(gameId);
    }

    function setResolver(address newResolver) external onlyOwner {
        require(newResolver != address(0), "resolver=0");
        resolver = newResolver;
        emit ResolverUpdated(newResolver);
    }

    function setAbandonTimeout(uint256 newTimeout) external onlyOwner {
        require(newTimeout > 0, "timeout=0");
        abandonTimeout = newTimeout;
        emit AbandonTimeoutUpdated(newTimeout);
    }
}
