import React, { createContext, useContext, useState, ReactNode } from 'react';

interface SleepModeContextType {
  isSleepMode: boolean;
  enterSleepMode: () => void;
  exitSleepMode: () => void;
}

const SleepModeContext = createContext<SleepModeContextType | undefined>(undefined);

interface SleepModeProviderProps {
  children: ReactNode;
}

export const SleepModeProvider: React.FC<SleepModeProviderProps> = ({ children }) => {
  const [isSleepMode, setIsSleepMode] = useState(false);

  const enterSleepMode = () => {
    console.log('enterSleepMode called');
    setIsSleepMode(true);
    console.log('Sleep mode state set to true');
  };

  const exitSleepMode = () => {
    console.log('exitSleepMode called');
    setIsSleepMode(false);
  };

  return (
    <SleepModeContext.Provider value={{ isSleepMode, enterSleepMode, exitSleepMode }}>
      {children}
    </SleepModeContext.Provider>
  );
};

export const useSleepMode = () => {
  const context = useContext(SleepModeContext);
  if (context === undefined) {
    throw new Error('useSleepMode must be used within a SleepModeProvider');
  }
  return context;
};
