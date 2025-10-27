declare global {
    interface Window {
        electronAPI: {
            authenticate: (credentials: any) => Promise<any>;
            getProducts: (params: {
                token: string;
                branchId?: string;
            }) => Promise<any>;
            createSale: (params: {
                token: string;
                saleData: any;
                branchId?: string;
            }) => Promise<any>;
            minimize: () => Promise<void>;
            maximize: () => Promise<void>;
            close: () => Promise<void>;
            onRealtimeUpdate: (callback: (event: any, data: any) => void) => () => void;
            getOfflineData: () => Promise<any>;
            syncOfflineData: () => Promise<any>;
        };
    }
}
export {};
//# sourceMappingURL=preload.d.ts.map