// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @dev Test-only token; never part of either production artifact.
contract AdversarialToken {
    uint8 public constant decimals = 18;
    uint256 public totalSupply = 1_000_000_000 ether;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public mode;
    address public callbackTarget;
    bytes public callbackData;
    bytes4 public callbackError;
    bool private insideCallback;
    constructor() { balanceOf[msg.sender] = totalSupply; }
    function setMode(uint256 value) external { mode = value; }
    function changeSupply() external { totalSupply += 1; }
    function configureCallback(address target, bytes calldata data) external {
        callbackTarget = target; callbackData = data;
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount; return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        return move(msg.sender, to, amount);
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "ALLOWANCE");
        allowance[from][msg.sender] -= amount;
        return move(from, to, amount);
    }
    function move(address from, address to, uint256 amount) private returns (bool) {
        require(balanceOf[from] >= amount, "BALANCE");
        if (!insideCallback && callbackTarget != address(0)) {
            insideCallback = true;
            (bool ok, bytes memory result) = callbackTarget.call(callbackData);
            require(!ok && result.length >= 4, "EXPECTED_REENTRY_REJECTION");
            callbackError = bytes4(result);
            insideCallback = false;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += mode == 1 ? amount - 1 : amount;
        if (mode == 2) { balanceOf[from] -= 1; }
        if (mode == 3) { totalSupply += 1; }
        if (mode == 4) return false;
        if (mode == 5) { assembly ("memory-safe") { return(0, 0) } }
        return true;
    }
}

contract BadMetadataToken {
    uint8 public immutable decimals;
    uint256 public immutable totalSupply;
    constructor(uint8 d, uint256 s) { decimals = d; totalSupply = s; }
}
