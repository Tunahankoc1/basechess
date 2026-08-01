import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploy with, e.g.:
//   npx hardhat ignition deploy ignition/modules/ChessEscrow.ts \
//     --network baseSepolia --parameters ignition/parameters/baseSepolia.json
export default buildModule("ChessEscrowModule", (m) => {
  const usdcAddress = m.getParameter("usdcAddress");
  const resolverAddress = m.getParameter("resolverAddress");

  const chessEscrow = m.contract("ChessEscrow", [usdcAddress, resolverAddress]);

  return { chessEscrow };
});
