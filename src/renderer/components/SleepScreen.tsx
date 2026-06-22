import React, { useEffect, useState } from 'react';
import './SleepScreen.css';
import loadingBackground from '../../../images/pexels-karola-g-4968635.jpg';

const backgroundImage = loadingBackground;

interface SleepScreenProps {
  onWake?: () => void;
}

const SleepScreen: React.FC<SleepScreenProps> = ({ onWake }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [mouseMoved, setMouseMoved] = useState(false);

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Handle wake on any interaction
  useEffect(() => {
    let wakeTimeout: NodeJS.Timeout;
    
    const handleInteraction = (e: Event) => {
      // Ignore small mouse movements (might be accidental)
      if (e.type === 'mousemove') {
        const mouseEvent = e as MouseEvent;
        // Only wake on significant mouse movement (more than 10px)
        if (Math.abs(mouseEvent.movementX) < 10 && Math.abs(mouseEvent.movementY) < 10) {
          return;
        }
      }
      
      // Clear any pending wake
      if (wakeTimeout) {
        clearTimeout(wakeTimeout);
      }
      
      // Small delay to prevent accidental wake
      wakeTimeout = setTimeout(() => {
        if (onWake) {
          console.log('Waking from sleep mode');
          onWake();
        }
      }, 100);
    };

    // Listen for various user interactions
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'click', 'wheel'];
    
    events.forEach(event => {
      window.addEventListener(event, handleInteraction, { passive: true });
    });

    return () => {
      if (wakeTimeout) {
        clearTimeout(wakeTimeout);
      }
      events.forEach(event => {
        window.removeEventListener(event, handleInteraction);
      });
    };
  }, [onWake]);

  // Format time
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <div className="sleep-screen">
      {/* Background Image Layer */}
      <div 
        className="sleep-background-image"
        style={{ 
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      ></div>
      
      {/* Gradient Overlay */}
      <div className="sleep-gradient-overlay"></div>
      
      {/* Animated Stars/Particles */}
      <div className="sleep-particles">
        {[...Array(30)].map((_, i) => (
          <div 
            key={i} 
            className="sleep-particle" 
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${2 + Math.random() * 3}s`
            }}
          ></div>
        ))}
      </div>

      {/* Floating Shapes */}
      <div className="sleep-shapes">
        <div className="sleep-shape sleep-shape-1"></div>
        <div className="sleep-shape sleep-shape-2"></div>
        <div className="sleep-shape sleep-shape-3"></div>
      </div>

      {/* Main Content */}
      <div className="sleep-content-wrapper">
        <div className="sleep-content">
          {/* Logo/Brand */}
          <div className="sleep-logo-container">
            <div className="sleep-logo-circle">
              <svg className="sleep-logo-icon" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="45" stroke="rgba(255,255,255,0.2)" strokeWidth="2"/>
                <path
                  d="M50 30 L50 50 L65 65"
                  stroke="url(#sleepGradient)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
                <defs>
                  <linearGradient id="sleepGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="100%" stopColor="#e0e7ff" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="sleep-logo-glow"></div>
            </div>
          </div>

          {/* Time Display */}
          <div className="sleep-time-container">
            <div className="sleep-time-main">
              {formatTime(currentTime).split(':').map((part, index) => (
                <span key={index} className="sleep-time-part">
                  {part}
                  {index < 2 && <span className="sleep-time-separator">:</span>}
                </span>
              ))}
            </div>
            <div className="sleep-date">{formatDate(currentTime)}</div>
          </div>

          {/* Wake Message */}
          <div className="sleep-wake-message">
            <div className="sleep-wake-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M12 2L2 7L12 12L22 7L12 2Z"
                  stroke="rgba(255,255,255,0.6)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M2 17L12 22L22 17"
                  stroke="rgba(255,255,255,0.6)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M2 12L12 17L22 12"
                  stroke="rgba(255,255,255,0.6)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="sleep-wake-text">Move mouse or press any key to wake</p>
          </div>

          {/* Animated Pulse Rings */}
          <div className="sleep-pulse-rings">
            <div className="sleep-pulse-ring ring-1"></div>
            <div className="sleep-pulse-ring ring-2"></div>
            <div className="sleep-pulse-ring ring-3"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SleepScreen;
