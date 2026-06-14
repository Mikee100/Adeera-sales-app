import React, { useEffect, useState } from 'react';
import './SyncScreen.css';

// Background image path - served by webpack dev server from /images
// In development, use full URL; in production, use relative path
const backgroundImage = process.env.NODE_ENV === 'development' 
  ? 'http://127.0.0.1:7000/images/pexels-karola-g-4968635.jpg'
  : '/images/pexels-karola-g-4968635.jpg';

interface SyncScreenProps {
  progress: number; // 0-100
  status: string;
  currentStep?: string;
  totalSteps?: number;
  completedSteps?: number;
}

const SyncScreen: React.FC<SyncScreenProps> = ({
  progress,
  status,
  currentStep,
  totalSteps,
  completedSteps,
}) => {
  const [animatedProgress, setAnimatedProgress] = useState(0);

  // Smooth animation for progress bar
  useEffect(() => {
    const duration = 300;
    const startProgress = animatedProgress;
    const progressDiff = progress - startProgress;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progressRatio = Math.min(elapsed / duration, 1);
      const easeOutCubic = 1 - Math.pow(1 - progressRatio, 3);
      const currentProgress = startProgress + progressDiff * easeOutCubic;
      
      setAnimatedProgress(currentProgress);

      if (progressRatio < 1) {
        requestAnimationFrame(animate);
      } else {
        setAnimatedProgress(progress);
      }
    };

    if (progress !== animatedProgress) {
      requestAnimationFrame(animate);
    }
  }, [progress]);


  return (
    <div className="sync-screen">
      {/* Background Image Layer */}
      <div 
        className="sync-background-image"
        style={{ 
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      ></div>

      {/* Main Content - Just Progress Bar */}
      <div className="sync-content-wrapper">
        <div className="sync-content">
          {/* Progress Container */}
          <div className="sync-progress-wrapper">
            <div className="sync-progress-bar-container">
              <div className="sync-progress-bar">
                <div
                  className="sync-progress-fill"
                  style={{ width: `${Math.min(100, Math.max(0, animatedProgress))}%` }}
                >
                  <div className="sync-progress-gradient"></div>
                  <div className="sync-progress-shine"></div>
                </div>
              </div>
              <div className="sync-progress-indicators">
                <div className="sync-progress-dot" style={{ left: `${Math.min(100, Math.max(0, animatedProgress))}%` }}></div>
              </div>
            </div>
            <div className="sync-progress-percentage">
              {Math.round(animatedProgress)}<span className="sync-percent-symbol">%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SyncScreen;
