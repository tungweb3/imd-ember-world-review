// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice LOCAL ONLY. Snapshot, catalogue, tentative price and administration need final review.
/// @dev No IMD seat id mapping, admin mint, burn, rarity, royalties, treasury split or automated asset operations.
contract EmberEvoGenesisCandidate is ERC721, IERC4906, Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    uint256 public constant MAX_SUPPLY = 2222;
    // Both paths open together. Unclaimed eligibility does not reserve supply.
    struct PaidAuthorization {
        bytes32 orderId;
        address wallet;
        bytes32 key;
        bytes32 uriHash;
        address recipient;
        uint256 embeoCost;
        uint256 goldCost;
        uint256 deadline;
        uint256 signerEpoch;
    }
    bytes32 private constant PAID_AUTH_TYPEHASH = keccak256("PaidAuthorization(bytes32 orderId,address wallet,bytes32 key,bytes32 uriHash,address recipient,uint256 embeoCost,uint256 goldCost,uint256 deadline,uint256 signerEpoch)");
    bytes32 private constant APPEARANCE_TYPEHASH = keccak256("Appearance(address wallet,bytes32 key,bytes32 uriHash,uint256 deadline,uint256 signerEpoch)");
    bytes32 private constant SIGNER_ACCEPTANCE_TYPEHASH = keccak256("SignerAcceptance(address signer,uint256 signerEpoch,uint256 proposalNonce,uint256 deadline)");
    bytes32 private constant PAID_TX_SLOT_PREFIX = keccak256("emberevo.genesis.paid-wallet-per-transaction.v1");
    IERC20 public immutable paymentToken;
    uint256 public immutable paidCost;
    uint256 public immutable paidGoldCost;
    mapping(bytes32 => uint256) public paidOrderTokenId;
    mapping(bytes32 => bool) public paidOrderRevoked;
    address public appearanceSigner;
    address public pendingAppearanceSigner;
    uint256 public signerEpoch = 1;
    uint256 public signerProposalNonce;
    address public paymentRecipient;
    bool public mintPaused = true;
    bool public paidPriceApproved;
    bool public snapshotConfigured;
    bytes32 public snapshotRoot;
    uint256 public eligibleWalletCount;
    uint256 public snapshotAt;
    uint256 public freeStartAt;
    uint256 public totalMinted;
    uint256 public freeMinted;
    uint256 public paidMinted;
    mapping(address => bool) public freeClaimed;
    mapping(bytes32 => bool) public appearanceUsed;
    mapping(uint256 => bytes32) public appearanceKey;
    mapping(uint256 => string) private metadataURIs;

    event SnapshotConfigured(bytes32 root, uint256 eligible, uint256 snapshotAt, uint256 commonStartAt);
    event PaidOrderConsumed(bytes32 indexed orderId, address indexed wallet, uint256 indexed tokenId, uint256 goldCost);
    event PaidOrderRevoked(bytes32 indexed orderId);
    event MintPauseChanged(bool paused);
    event PaidPriceApproved(uint256 cost);
    event PaymentRecipientChanged(address indexed previous, address indexed next);
    event AppearanceSignerProposed(address indexed proposed, uint256 nextEpoch, uint256 proposalNonce);
    event AppearanceSignerProposalCancelled(address indexed proposed, uint256 revokedProposalNonce);
    event AppearanceSignerChanged(address indexed previous, address indexed next, uint256 epoch);
    event MetadataUpdated(uint256 indexed tokenId, string uri);
    event GenesisMinted(address indexed wallet, uint256 indexed tokenId, bytes32 indexed key, bool paid, uint256 cost);

    constructor(address owner_, address token_, address recipient_, address signer_, uint256 cost_, uint256 goldCost_, string memory symbol_)
        ERC721("Ember Evo Genesis (LOCAL CANDIDATE)", symbol_) Ownable(owner_) EIP712("EmberEvoGenesisCandidate", "4")
    {
        require(block.chainid == 31337, "LOCAL_CHAIN_ONLY");
        require(token_.code.length != 0 && IERC20Metadata(token_).decimals() == 18, "TOKEN_IDENTITY_REQUIRED");
        require(recipient_ != address(0) && recipient_ != address(this) && signer_ != address(0) && signer_ != address(this), "INVALID_ROLE");
        require(cost_ != 0 && goldCost_ != 0 && bytes(symbol_).length != 0, "PARAMETERS_REQUIRED");
        paymentToken = IERC20(token_); paymentRecipient = recipient_; appearanceSigner = signer_; paidCost = cost_;
        paidGoldCost = goldCost_;
    }

    /// Snapshot root/count is sealed once. Dates are supplied only after the real snapshot has been verified.
    function configureSnapshot(bytes32 root, uint256 eligible, uint256 at, uint256 start) external onlyOwner {
        require(!snapshotConfigured && totalMinted == 0, "SNAPSHOT_ALREADY_FIXED");
        require(eligible <= MAX_SUPPLY && (eligible == 0 || root != bytes32(0)), "SNAPSHOT_CAPACITY");
        require(at != 0 && at <= block.timestamp && start >= block.timestamp && start >= at, "SNAPSHOT_TIME");
        snapshotConfigured = true; snapshotRoot = root; eligibleWalletCount = eligible; snapshotAt = at;
        freeStartAt = start;
        emit SnapshotConfigured(root, eligible, at, start);
    }
    function setMintPaused(bool paused) external onlyOwner nonReentrant {
        require(paused || pendingAppearanceSigner == address(0), "SIGNER_PROPOSAL_PENDING");
        mintPaused = paused; emit MintPauseChanged(paused);
    }
    /// Administrative controls are retained; ownership may still be transferred in two steps.
    function renounceOwnership() public view override onlyOwner { revert("OWNERSHIP_RENOUNCE_DISABLED"); }
    function proposeAppearanceSigner(address next) external onlyOwner nonReentrant {
        require(mintPaused, "PAUSE_REQUIRED");
        require(next != address(0) && next != address(this) && next != appearanceSigner, "INVALID_SIGNER");
        require(pendingAppearanceSigner == address(0), "SIGNER_PROPOSAL_PENDING");
        pendingAppearanceSigner = next;
        ++signerProposalNonce;
        emit AppearanceSignerProposed(next, signerEpoch + 1, signerProposalNonce);
    }
    /// New authority accepts this exact proposal. Cancelling invalidates its nonce permanently.
    function activateAppearanceSigner(uint256 deadline, bytes calldata acceptance) external onlyOwner nonReentrant {
        require(mintPaused && pendingAppearanceSigner != address(0), "SIGNER_PROPOSAL_REQUIRED");
        require(block.timestamp <= deadline, "SIGNER_ACCEPTANCE_EXPIRED");
        address next = pendingAppearanceSigner;
        uint256 epoch = signerEpoch + 1;
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SIGNER_ACCEPTANCE_TYPEHASH, next, epoch, signerProposalNonce, deadline)));
        require(SignatureChecker.isValidSignatureNow(next, digest, acceptance), "SIGNER_ACCEPTANCE_INVALID");
        address previous = appearanceSigner;
        appearanceSigner = next; signerEpoch = epoch; pendingAppearanceSigner = address(0);
        emit AppearanceSignerChanged(previous, next, epoch);
    }
    function cancelAppearanceSignerProposal() external onlyOwner nonReentrant {
        address proposed = pendingAppearanceSigner;
        require(proposed != address(0), "SIGNER_PROPOSAL_REQUIRED");
        uint256 revokedNonce = signerProposalNonce;
        pendingAppearanceSigner = address(0);
        ++signerProposalNonce;
        emit AppearanceSignerProposalCancelled(proposed, revokedNonce);
    }
    /// This local fixture approval cannot authorize the tentative price on a public chain.
    function approvePaidPriceForLocalTest() external onlyOwner { paidPriceApproved = true; emit PaidPriceApproved(paidCost); }
    function setPaymentRecipient(address next) external onlyOwner nonReentrant {
        require(next != address(0) && next != address(this), "INVALID_RECIPIENT");
        address previous = paymentRecipient; paymentRecipient = next; emit PaymentRecipientChanged(previous, next);
    }
    function setTokenURI(uint256 id, string calldata uri) external onlyOwner {
        _requireOwned(id); require(bytes(uri).length != 0, "METADATA_REQUIRED");
        metadataURIs[id] = uri; emit MetadataUpdated(id, uri); emit MetadataUpdate(id);
    }
    function supportsInterface(bytes4 id) public view override(ERC721, IERC165) returns (bool) {
        return id == bytes4(0x49064906) || super.supportsInterface(id);
    }
    function tokenURI(uint256 id) public view override returns (string memory) { _requireOwned(id); return metadataURIs[id]; }
    function tokenDisplayName(uint256 id) public view returns (string memory) { _requireOwned(id); return string.concat("Ember Evo ", Strings.toString(id)); }
    function remainingFreeReservation() public view returns (uint256) {
        return 0;
    }
    function paidAvailability() public view returns (uint256) {
        if (!snapshotConfigured || block.timestamp < freeStartAt) return 0;
        return MAX_SUPPLY - totalMinted;
    }
    function _approval(bytes32 key, string calldata uri, uint256 deadline, bytes calldata signature) private view {
        require(!mintPaused && snapshotConfigured, "MINT_NOT_READY");
        require(key != bytes32(0) && !appearanceUsed[key] && bytes(uri).length != 0, "APPEARANCE_UNAVAILABLE");
        require(block.timestamp <= deadline, "APPEARANCE_EXPIRED");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(APPEARANCE_TYPEHASH, msg.sender, key, keccak256(bytes(uri)), deadline, signerEpoch)));
        require(SignatureChecker.isValidSignatureNow(appearanceSigner, digest, signature), "APPEARANCE_AUTHORITY");
    }
    function _mintOne(bytes32 key, string calldata uri, bool paid, uint256 cost) private {
        require(totalMinted < MAX_SUPPLY, "SOLD_OUT");
        uint256 id = ++totalMinted; appearanceUsed[key] = true; appearanceKey[id] = key; metadataURIs[id] = uri;
        _safeMint(msg.sender, id); emit GenesisMinted(msg.sender, id, key, paid, cost);
    }
    function mintFree(bytes32 key, string calldata uri, uint256 deadline, bytes calldata signature, bytes32[] calldata proof) external nonReentrant {
        _approval(key, uri, deadline, signature);
        require(block.timestamp >= freeStartAt, "SALE_NOT_STARTED");
        require(!freeClaimed[msg.sender] && freeMinted < eligibleWalletCount, "FREE_ALREADY_CLAIMED");
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
        require(MerkleProof.verifyCalldata(proof, snapshotRoot, leaf), "NOT_IN_SNAPSHOT");
        freeClaimed[msg.sender] = true; ++freeMinted; _mintOne(key, uri, false, 0);
    }
    /// A successful paid mint consumes this caller's marker for the rest of this transaction.
    /// Do not clear the transient slot on return: sequential smart-wallet calls must also be limited.
    function _claimPaidTransaction() private {
        bytes32 slot = keccak256(abi.encode(PAID_TX_SLOT_PREFIX, msg.sender));
        uint256 used;
        assembly ("memory-safe") { used := tload(slot) }
        require(used == 0, "ONE_PAID_MINT_PER_TRANSACTION");
        assembly ("memory-safe") { tstore(slot, 1) }
    }
    /// One paid token per caller per transaction; future transactions have no per-wallet total limit.
    function mintPaid(bytes32 key, string calldata uri, uint256 deadline, bytes calldata signature, address expectedRecipient, uint256 expectedCost, PaidAuthorization calldata order, bytes calldata goldSignature) external nonReentrant {
        _approval(key, uri, deadline, signature);
        require(block.timestamp >= freeStartAt, "SALE_NOT_STARTED");
        require(paidPriceApproved && paidAvailability() != 0, "PAID_NOT_AVAILABLE");
        address recipient = paymentRecipient;
        address signer = appearanceSigner;
        uint256 epoch = signerEpoch;
        require(expectedRecipient == recipient && expectedCost == paidCost, "PAYMENT_CONTEXT_CHANGED");
        require(order.orderId != bytes32(0) && paidOrderTokenId[order.orderId] == 0 && !paidOrderRevoked[order.orderId], "PAID_ORDER_UNAVAILABLE");
        require(order.wallet == msg.sender && order.key == key && order.uriHash == keccak256(bytes(uri)) && order.recipient == recipient && order.embeoCost == paidCost && order.goldCost == paidGoldCost && order.signerEpoch == epoch, "GOLD_AUTH_CONTEXT");
        require(block.timestamp <= order.deadline, "GOLD_AUTH_EXPIRED");
        bytes32 goldDigest = _hashTypedDataV4(keccak256(abi.encode(PAID_AUTH_TYPEHASH, order)));
        require(SignatureChecker.isValidSignatureNow(signer, goldDigest, goldSignature), "GOLD_RESERVATION_AUTHORITY");
        _claimPaidTransaction();
        // Off-chain GOLD was reserved before this authorization was signed.
        // This receipt and the NFT/payment revert together; it is not an on-chain GOLD token.
        paidOrderTokenId[order.orderId] = totalMinted + 1;
        uint256 payerBefore = paymentToken.balanceOf(msg.sender);
        uint256 recipientBefore = paymentToken.balanceOf(recipient);
        uint256 supplyBefore = paymentToken.totalSupply();
        ++paidMinted;
        // nonReentrant guards both mint paths while the external token call is in progress.
        require(payerBefore >= paidCost, "BALANCE_REQUIRED");
        paymentToken.safeTransferFrom(msg.sender, recipient, paidCost);
        require(paymentToken.balanceOf(msg.sender) == payerBefore - paidCost && paymentToken.balanceOf(recipient) == recipientBefore + paidCost, "EXACT_PAYMENT_REQUIRED");
        require(paymentToken.totalSupply() == supplyBefore, "TOKEN_SUPPLY_CHANGED");
        _mintOne(key, uri, true, paidCost);
        emit PaidOrderConsumed(order.orderId, msg.sender, totalMinted, paidGoldCost);
        require(paymentRecipient == recipient && appearanceSigner == signer && signerEpoch == epoch && !mintPaused, "MINT_CONTEXT_CHANGED");
    }
    /// Prevent a still-valid authorization from spending a reservation after cancellation.
    /// GOLD release requires an authoritative consumed/revoked/expired read, not a UI timeout.
    function revokePaidOrder(bytes32 orderId) external onlyOwner nonReentrant {
        require(orderId != bytes32(0) && paidOrderTokenId[orderId] == 0, "PAID_ORDER_ALREADY_CONSUMED");
        paidOrderRevoked[orderId] = true;
        emit PaidOrderRevoked(orderId);
    }
}
