import { useState, useEffect } from 'react';

export interface PendingTransaction {
  id: string;
  cart: Array<{
    product: any;
    quantity: number;
  }>;
  timestamp: string;
  customerName?: string;
  customerPhone?: string;
}

const STORAGE_KEY = 'pos-pending-transactions';

export const usePendingTransactions = () => {
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([]);

  useEffect(() => {
    // Load pending transactions from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setPendingTransactions(parsed);
      } catch (error) {
        console.error('Failed to load pending transactions:', error);
      }
    }
  }, []);

  const savePendingTransactions = (transactions: PendingTransaction[]) => {
    setPendingTransactions(transactions);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  };

  const holdTransaction = (cart: Array<{ product: any; quantity: number }>, customerName?: string, customerPhone?: string) => {
    const newTransaction: PendingTransaction = {
      id: `pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      cart: cart.map(item => ({
        product: item.product,
        quantity: item.quantity,
      })),
      timestamp: new Date().toISOString(),
      customerName,
      customerPhone,
    };

    const updated = [...pendingTransactions, newTransaction];
    savePendingTransactions(updated);
    return newTransaction.id;
  };

  const resumeTransaction = (transactionId: string): PendingTransaction | null => {
    const transaction = pendingTransactions.find(t => t.id === transactionId);
    return transaction || null;
  };

  const deleteTransaction = (transactionId: string) => {
    const updated = pendingTransactions.filter(t => t.id !== transactionId);
    savePendingTransactions(updated);
  };

  const clearAllPending = () => {
    savePendingTransactions([]);
  };

  return {
    pendingTransactions,
    holdTransaction,
    resumeTransaction,
    deleteTransaction,
    clearAllPending,
  };
};

