pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SurveyZama is ZamaEthereumConfig {
    struct EncryptedResponse {
        euint32 encryptedAge;
        euint32 encryptedIncome;
        euint32 encryptedSatisfaction;
        uint256 publicCategory;
        uint256 timestamp;
        bool isVerified;
    }

    struct SurveyStats {
        uint32 totalResponses;
        euint32 sumAge;
        euint32 sumIncome;
        euint32 sumSatisfaction;
    }

    mapping(uint256 => EncryptedResponse) public responses;
    mapping(uint256 => SurveyStats) public categoryStats;
    uint256[] public responseIds;
    uint256[] public categoryIds;

    event ResponseSubmitted(uint256 indexed responseId, uint256 category);
    event ResponseVerified(uint256 indexed responseId);
    event StatsUpdated(uint256 indexed categoryId, uint256 totalResponses);

    constructor() ZamaEthereumConfig() {
        // Initialize with default settings
    }

    function submitResponse(
        uint256 publicCategory,
        externalEuint32 encryptedAge,
        bytes calldata ageProof,
        externalEuint32 encryptedIncome,
        bytes calldata incomeProof,
        externalEuint32 encryptedSatisfaction,
        bytes calldata satisfactionProof
    ) external {
        uint256 responseId = responseIds.length;

        require(FHE.isInitialized(FHE.fromExternal(encryptedAge, ageProof)), "Invalid age encryption");
        require(FHE.isInitialized(FHE.fromExternal(encryptedIncome, incomeProof)), "Invalid income encryption");
        require(FHE.isInitialized(FHE.fromExternal(encryptedSatisfaction, satisfactionProof)), "Invalid satisfaction encryption");

        responses[responseId] = EncryptedResponse({
            encryptedAge: FHE.fromExternal(encryptedAge, ageProof),
            encryptedIncome: FHE.fromExternal(encryptedIncome, incomeProof),
            encryptedSatisfaction: FHE.fromExternal(encryptedSatisfaction, satisfactionProof),
            publicCategory: publicCategory,
            timestamp: block.timestamp,
            isVerified: false
        });

        FHE.allowThis(responses[responseId].encryptedAge);
        FHE.allowThis(responses[responseId].encryptedIncome);
        FHE.allowThis(responses[responseId].encryptedSatisfaction);

        FHE.makePubliclyDecryptable(responses[responseId].encryptedAge);
        FHE.makePubliclyDecryptable(responses[responseId].encryptedIncome);
        FHE.makePubliclyDecryptable(responses[responseId].encryptedSatisfaction);

        responseIds.push(responseId);

        if (categoryStats[publicCategory].totalResponses == 0) {
            categoryIds.push(publicCategory);
        }

        emit ResponseSubmitted(responseId, publicCategory);
    }

    function verifyResponse(
        uint256 responseId,
        bytes memory ageProof,
        bytes memory incomeProof,
        bytes memory satisfactionProof
    ) external {
        require(responseId < responseIds.length, "Invalid response ID");
        require(!responses[responseId].isVerified, "Response already verified");

        bytes32[] memory cts = new bytes32[](3);
        cts[0] = FHE.toBytes32(responses[responseId].encryptedAge);
        cts[1] = FHE.toBytes32(responses[responseId].encryptedIncome);
        cts[2] = FHE.toBytes32(responses[responseId].encryptedSatisfaction);

        FHE.checkSignatures(cts, "", ageProof);
        FHE.checkSignatures(cts, "", incomeProof);
        FHE.checkSignatures(cts, "", satisfactionProof);

        responses[responseId].isVerified = true;
        emit ResponseVerified(responseId);
    }

    function updateCategoryStats(uint256 categoryId) external {
        require(categoryStats[categoryId].totalResponses > 0, "Category has no responses");

        euint32 memory sumAge = euint32.wrap(0);
        euint32 memory sumIncome = euint32.wrap(0);
        euint32 memory sumSatisfaction = euint32.wrap(0);
        uint32 count = 0;

        for (uint256 i = 0; i < responseIds.length; i++) {
            if (responses[i].publicCategory == categoryId && responses[i].isVerified) {
                sumAge = FHE.add(sumAge, responses[i].encryptedAge);
                sumIncome = FHE.add(sumIncome, responses[i].encryptedIncome);
                sumSatisfaction = FHE.add(sumSatisfaction, responses[i].encryptedSatisfaction);
                count++;
            }
        }

        categoryStats[categoryId] = SurveyStats({
            totalResponses: count,
            sumAge: sumAge,
            sumIncome: sumIncome,
            sumSatisfaction: sumSatisfaction
        });

        emit StatsUpdated(categoryId, count);
    }

    function getResponse(uint256 responseId) external view returns (
        euint32 encryptedAge,
        euint32 encryptedIncome,
        euint32 encryptedSatisfaction,
        uint256 publicCategory,
        uint256 timestamp,
        bool isVerified
    ) {
        require(responseId < responseIds.length, "Invalid response ID");
        EncryptedResponse storage response = responses[responseId];
        return (
            response.encryptedAge,
            response.encryptedIncome,
            response.encryptedSatisfaction,
            response.publicCategory,
            response.timestamp,
            response.isVerified
        );
    }

    function getCategoryStats(uint256 categoryId) external view returns (
        uint32 totalResponses,
        euint32 sumAge,
        euint32 sumIncome,
        euint32 sumSatisfaction
    ) {
        SurveyStats storage stats = categoryStats[categoryId];
        return (
            stats.totalResponses,
            stats.sumAge,
            stats.sumIncome,
            stats.sumSatisfaction
        );
    }

    function getAllResponseIds() external view returns (uint256[] memory) {
        return responseIds;
    }

    function getAllCategoryIds() external view returns (uint256[] memory) {
        return categoryIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

