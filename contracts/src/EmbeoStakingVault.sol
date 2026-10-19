// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ExactEmbeo} from "./ExactEmbeo.sol";

/// @notice Ownerless custody of refundable EMBEO principal. It does not issue GOLD.
/// @dev Each deposit is a separate, nontransferable position. The indexer determines
/// completed UTC-day rewards from finalized event timestamps, never a client clock.
contract EmbeoStakingVault is ExactEmbeo, ReentrancyGuard {
    uint256 public constant SHARE_SIZE = 100_000 * 10 ** 18;
    struct Position { address player; uint256 shares; }
    mapping(uint256 positionId => Position) public positions;
    uint256 public nextPositionId = 1;
    uint256 public totalShares;

    error InvalidShares();
    error NotPositionOwner();
    error InsufficientShares();

    event Staked(address indexed player, uint256 indexed positionId, uint256 shares, uint256 amount);
    event Withdrawn(address indexed player, uint256 indexed positionId, uint256 shares, uint256 amount);

    constructor(address token_) ExactEmbeo(token_) {}

    function deposit(uint256 shares) external nonReentrant returns (uint256 positionId) {
        if (shares == 0) revert InvalidShares();
        uint256 amount = shares * SHARE_SIZE;
        positionId = nextPositionId++;
        positions[positionId] = Position(msg.sender, shares);
        totalShares += shares;
        _transferExact(msg.sender, address(this), amount, true);
        emit Staked(msg.sender, positionId, shares, amount);
    }

    function withdraw(uint256 positionId, uint256 shares) external nonReentrant {
        if (shares == 0) revert InvalidShares();
        Position storage position = positions[positionId];
        if (position.player != msg.sender) revert NotPositionOwner();
        if (position.shares < shares) revert InsufficientShares();
        position.shares -= shares;
        totalShares -= shares;
        uint256 amount = shares * SHARE_SIZE;
        _transferExact(address(this), msg.sender, amount, false);
        emit Withdrawn(msg.sender, positionId, shares, amount);
    }
}
