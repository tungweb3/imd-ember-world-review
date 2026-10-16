// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Fixed-token adapter. It has no allowance, arbitrary-call, rescue or admin entry point.
/// The deployment gate MUST verify Ethereum EMBEO address/runtime; decimals alone are not identity.
abstract contract ExactEmbeo {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    bytes32 public immutable tokenCodeHash;
    uint256 public immutable tokenSupply;

    error InvalidToken();
    error InvalidTransferParties();
    error ExactTransferRequired();
    error TokenChanged();

    constructor(address token_) {
        if (token_.code.length == 0 || IERC20Metadata(token_).decimals() != 18) revert InvalidToken();
        token = IERC20(token_);
        tokenCodeHash = token_.codehash;
        tokenSupply = IERC20(token_).totalSupply();
        if (tokenSupply == 0) revert InvalidToken();
    }

    function _transferExact(address from, address to, uint256 amount, bool pull) internal {
        if (from == to || from == address(0) || to == address(0)) revert InvalidTransferParties();
        if (address(token).codehash != tokenCodeHash || token.totalSupply() != tokenSupply) revert TokenChanged();
        uint256 beforeFrom = token.balanceOf(from);
        uint256 beforeTo = token.balanceOf(to);
        if (beforeFrom < amount) revert ExactTransferRequired();
        if (pull) token.safeTransferFrom(from, to, amount);
        else token.safeTransfer(to, amount);
        if (
            token.balanceOf(from) != beforeFrom - amount ||
            token.balanceOf(to) != beforeTo + amount ||
            token.totalSupply() != tokenSupply
        ) revert ExactTransferRequired();
    }
}
