import { create } from 'zustand';

export type RestaurantScreen =
  | 'dashboard'
  | 'pos'
  | 'orders'
  | 'activity'
  | 'kitchen'
  | 'tables'
  | 'reservations'
  | 'inventory'
  | 'customers'
  | 'employees'
  | 'reports'
  | 'settings';

interface RestaurantUiState {
  sidebarCollapsed: boolean;
  activeScreen: RestaurantScreen;
  paymentModalOpen: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveScreen: (screen: RestaurantScreen) => void;
  setPaymentModalOpen: (open: boolean) => void;
}

export const useRestaurantUiStore = create<RestaurantUiState>((set) => ({
  sidebarCollapsed: true,
  activeScreen: 'pos',
  paymentModalOpen: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setActiveScreen: (screen) => set({ activeScreen: screen }),
  setPaymentModalOpen: (open) => set({ paymentModalOpen: open }),
}));
