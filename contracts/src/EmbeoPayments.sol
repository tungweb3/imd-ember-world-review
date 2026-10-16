// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ExactEmbeo} from "./ExactEmbeo.sol";

/// @notice Transfers only the caller's approved EMBEO directly to the immutable treasury.
/// @dev The backend must match a finalized Paid event against the exact wallet, order,
/// price and receipt. Calling pay does not grant a service or authorize an arbitrary quote.
contract EmbeoPayments is ExactEmbeo, ReentrancyGuard {
    address public immutable treasury;
    // A manual mis-amount transfer must not consume the exact quote's slot.
    // The backend still grants at most one service for its exact immutable quote.
    mapping(address payer => mapping(bytes32 orderId => mapping(uint256 amount => bool))) public paid;

    error InvalidTreasury();
    error InvalidOrder();
    error InvalidAmount();
    error OrderAlreadyPaid();

    event Paid(bytes32 indexed orderId, address indexed payer, address indexed token, address receiver, uint256 amount);

    constructor(address token_, address treasury_) ExactEmbeo(token_) {
        if (treasury_ == address(0) || treasury_ == address(this) || treasury_ == token_) revert InvalidTreasury();
        treasury = treasury_;
    }

    function pay(bytes32 orderId, uint256 amount) external nonReentrant {
        if (orderId == bytes32(0)) revert InvalidOrder();
        if (amount == 0) revert InvalidAmount();
        if (paid[msg.sender][orderId][amount]) revert OrderAlreadyPaid();
        paid[msg.sender][orderId][amount] = true;
        _transferExact(msg.sender, treasury, amount, true);
        emit Paid(orderId, msg.sender, address(token), treasury, amount);
    }
}
