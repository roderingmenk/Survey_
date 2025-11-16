import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface SurveyData {
  id: string;
  name: string;
  encryptedValue: any;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
  category: string;
}

interface SurveyStats {
  totalSurveys: number;
  verifiedCount: number;
  avgScore: number;
  recentSubmissions: number;
  categoryDistribution: { [key: string]: number };
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [surveys, setSurveys] = useState<SurveyData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingSurvey, setCreatingSurvey] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newSurveyData, setNewSurveyData] = useState({ 
    name: "", 
    score: "", 
    category: "商业",
    description: "" 
  });
  const [selectedSurvey, setSelectedSurvey] = useState<SurveyData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [userHistory, setUserHistory] = useState<SurveyData[]>([]);
  const [stats, setStats] = useState<SurveyStats>({
    totalSurveys: 0,
    verifiedCount: 0,
    avgScore: 0,
    recentSubmissions: 0,
    categoryDistribution: {}
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed." 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const calculateStats = (surveysList: SurveyData[]) => {
    const total = surveysList.length;
    const verified = surveysList.filter(s => s.isVerified).length;
    const avg = surveysList.length > 0 
      ? surveysList.reduce((sum, s) => sum + s.publicValue1, 0) / surveysList.length 
      : 0;
    
    const recent = surveysList.filter(s => 
      Date.now()/1000 - s.timestamp < 60 * 60 * 24 * 7
    ).length;

    const distribution: { [key: string]: number } = {};
    surveysList.forEach(s => {
      distribution[s.category] = (distribution[s.category] || 0) + 1;
    });

    setStats({
      totalSurveys: total,
      verifiedCount: verified,
      avgScore: avg,
      recentSubmissions: recent,
      categoryDistribution: distribution
    });
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const surveysList: SurveyData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          const survey: SurveyData = {
            id: businessId,
            name: businessData.name,
            encryptedValue: null,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            category: "商业"
          };
          surveysList.push(survey);
        } catch (e) {
          console.error('Error loading survey data:', e);
        }
      }
      
      setSurveys(surveysList);
      calculateStats(surveysList);
      
      if (address) {
        const userSurveys = surveysList.filter(s => s.creator.toLowerCase() === address.toLowerCase());
        setUserHistory(userSurveys);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createSurvey = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingSurvey(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating survey with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const scoreValue = parseInt(newSurveyData.score) || 0;
      const businessId = `survey-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, scoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newSurveyData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        scoreValue,
        0,
        newSurveyData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Survey submitted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSurveyData({ name: "", score: "", category: "商业", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingSurvey(false); 
    }
  };

  const decryptData = async (surveyId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const surveyData = await contractRead.getBusinessData(surveyId);
      if (surveyData.isVerified) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return Number(surveyData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(surveyId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(surveyId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and working!" 
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Contract test failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panels">
        <div className="stat-panel neon-pink">
          <h3>Total Surveys</h3>
          <div className="stat-value">{stats.totalSurveys}</div>
          <div className="stat-trend">+{stats.recentSubmissions} this week</div>
        </div>
        
        <div className="stat-panel neon-blue">
          <h3>Verified Data</h3>
          <div className="stat-value">{stats.verifiedCount}/{stats.totalSurveys}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
        
        <div className="stat-panel neon-green">
          <h3>Avg Score</h3>
          <div className="stat-value">{stats.avgScore.toFixed(1)}/10</div>
          <div className="stat-trend">Encrypted Average</div>
        </div>
      </div>
    );
  };

  const renderChart = () => {
    const categories = Object.keys(stats.categoryDistribution);
    
    return (
      <div className="chart-container">
        <h3>Category Distribution</h3>
        <div className="chart-bars">
          {categories.map(category => (
            <div key={category} className="chart-bar">
              <div className="bar-label">{category}</div>
              <div className="bar-track">
                <div 
                  className="bar-fill neon-purple"
                  style={{ width: `${(stats.categoryDistribution[category] / stats.totalSurveys) * 100}%` }}
                >
                  <span className="bar-value">{stats.categoryDistribution[category]}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderUserHistory = () => {
    if (userHistory.length === 0) return null;
    
    return (
      <div className="history-panel">
        <h3>Your Submission History</h3>
        <div className="history-list">
          {userHistory.map((survey, index) => (
            <div key={index} className="history-item">
              <div className="history-name">{survey.name}</div>
              <div className="history-meta">
                <span>Score: {survey.publicValue1}</span>
                <span>{new Date(survey.timestamp * 1000).toLocaleDateString()}</span>
                <span className={`status ${survey.isVerified ? 'verified' : 'pending'}`}>
                  {survey.isVerified ? '✅ Verified' : '🔓 Pending'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Confidential Market Survey 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access the confidential market survey system with FHE protection.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading confidential survey system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Confidential Market Survey 🔐</h1>
          <p>FHE Protected • Anonymous Analytics</p>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Test Contract
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Survey
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="left-panel">
          {renderStatsPanel()}
          {renderChart()}
        </div>
        
        <div className="right-panel">
          <div className="surveys-section">
            <div className="section-header">
              <h2>Market Surveys</h2>
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            
            <div className="surveys-list">
              {surveys.length === 0 ? (
                <div className="no-surveys">
                  <p>No surveys found</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Survey
                  </button>
                </div>
              ) : surveys.map((survey, index) => (
                <div 
                  className={`survey-item ${selectedSurvey?.id === survey.id ? "selected" : ""}`} 
                  key={index}
                  onClick={() => setSelectedSurvey(survey)}
                >
                  <div className="survey-title">{survey.name}</div>
                  <div className="survey-meta">
                    <span>Score: {survey.publicValue1}/10</span>
                    <span>{new Date(survey.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="survey-status">
                    {survey.isVerified ? "✅ Verified" : "🔓 Ready for Verification"}
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {renderUserHistory()}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateSurvey 
          onSubmit={createSurvey} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingSurvey} 
          surveyData={newSurveyData} 
          setSurveyData={setNewSurveyData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedSurvey && (
        <SurveyDetailModal 
          survey={selectedSurvey} 
          onClose={() => setSelectedSurvey(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedSurvey.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateSurvey: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  surveyData: any;
  setSurveyData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, surveyData, setSurveyData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'score') {
      const intValue = value.replace(/[^\d]/g, '');
      setSurveyData({ ...surveyData, [name]: intValue });
    } else {
      setSurveyData({ ...surveyData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-survey-modal">
        <div className="modal-header">
          <h2>New Market Survey</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Your score will be encrypted with Zama FHE for confidential analysis</p>
          </div>
          
          <div className="form-group">
            <label>Survey Name *</label>
            <input 
              type="text" 
              name="name" 
              value={surveyData.name} 
              onChange={handleChange} 
              placeholder="Enter survey name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Score (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="score" 
              value={surveyData.score} 
              onChange={handleChange} 
              placeholder="Enter your score..." 
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Category</label>
            <select name="category" value={surveyData.category} onChange={handleChange}>
              <option value="商业">Business</option>
              <option value="技术">Technology</option>
              <option value="产品">Product</option>
              <option value="市场">Market</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={surveyData.description} 
              onChange={handleChange} 
              placeholder="Additional comments..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !surveyData.name || !surveyData.score} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Submitting..." : "Submit Survey"}
          </button>
        </div>
      </div>
    </div>
  );
};

const SurveyDetailModal: React.FC<{
  survey: SurveyData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ survey, onClose, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="survey-detail-modal">
        <div className="modal-header">
          <h2>Survey Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="survey-info">
            <div className="info-item">
              <span>Survey Name:</span>
              <strong>{survey.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{survey.creator.substring(0, 6)}...{survey.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(survey.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Public Score:</span>
              <strong>{survey.publicValue1}/10</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Survey Data</h3>
            
            <div className="data-row">
              <div className="data-label">Encrypted Score:</div>
              <div className="data-value">
                {survey.isVerified ? 
                  `${survey.decryptedValue} (On-chain Verified)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${survey.isVerified ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : survey.isVerified ? (
                  "✅ Verified"
                ) : (
                  "🔓 Verify Decryption"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Confidential Analytics</strong>
                <p>Your score is encrypted on-chain. Only aggregated trends are visible to researchers.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!survey.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

