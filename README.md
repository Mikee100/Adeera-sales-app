# SaaS POS - Desktop Point of Sale Application

A desktop Electron application that serves as a dedicated Point of Sale system for the SaaS Platform, providing a native-like experience for retail operations.

## Features

### Core POS Functionality
- **Product Management**: Browse and search products with real-time inventory
- **Shopping Cart**: Add, remove, and modify items with quantity controls
- **Payment Processing**: Support for cash and M-Pesa payments
- **Receipt Generation**: Automatic receipt printing capabilities
- **Multi-branch Support**: Switch between different store locations

### Advanced Features
- **Real-time Updates**: Live inventory synchronization with main SaaS
- **Offline Mode**: Continue operations during connectivity issues
- **Keyboard Shortcuts**: Efficient operation for busy retail environments
- **Barcode Scanning**: Quick product lookup via barcode
- **Sales Analytics**: Real-time sales tracking and reporting

### Technical Features
- **Cross-platform**: Windows, macOS, and Linux support
- **Auto-updates**: Seamless application updates
- **Hardware Integration**: Receipt printers, barcode scanners
- **Data Synchronization**: Conflict resolution for offline/online sync

## Architecture

### Main Process (Electron Main)
- Window management and system integration
- IPC communication with renderer
- API calls to main SaaS backend
- Hardware device communication

### Renderer Process (React)
- Modern React-based UI
- Component-based architecture
- Real-time state management
- Responsive design for touch screens

### Shared Configuration
- Centralized configuration management
- Environment-specific settings
- Feature flags and capabilities

## Project Structure

```
sales-app/
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.ts     # Main application entry
│   │   └── preload.ts  # IPC preload script
│   ├── renderer/       # React renderer process
│   │   ├── index.tsx   # React entry point
│   │   ├── App.tsx     # Main application component
│   │   ├── styles.css  # Global styles
│   │   ├── components/ # React components
│   │   │   ├── Login.tsx
│   │   │   └── POS.tsx
│   │   └── contexts/   # React contexts
│   │       └── AuthContext.tsx
│   └── shared/         # Shared utilities
│       └── config.ts   # Configuration constants
├── dist/               # Build output
├── package.json        # Dependencies and scripts
├── tsconfig.json       # TypeScript configuration
└── webpack.config.js   # Webpack bundler config
```

## Development Setup

### Prerequisites
- Node.js 16+ and npm
- Git

### Installation

1. **Clone and navigate to the sales-app directory**
   ```bash
   cd sales-app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development mode**
   ```bash
   npm run dev
   ```

This will start the development server with hot reloading.

### Build for Production

```bash
# Build the application
npm run build

# Package for current platform
npm run package

# Package for all platforms
npm run package:all
```

## Integration with Main SaaS

### Authentication
- SSO integration with main SaaS platform
- JWT token management with automatic refresh
- Role-based permissions maintained

### API Communication
- RESTful API calls to main backend
- WebSocket connections for real-time updates
- Error handling and retry logic

### Data Synchronization
- Real-time sync for inventory changes
- Offline queue for sales during connectivity issues
- Conflict resolution algorithms

## Configuration

### Environment Variables
- `API_BASE_URL`: Main SaaS API endpoint
- `WS_BASE_URL`: WebSocket endpoint for real-time updates
- `NODE_ENV`: Development/production mode

### Feature Flags
- `offlineMode`: Enable/disable offline capabilities
- `multiBranch`: Enable/disable multi-branch support
- `receiptPrinting`: Enable/disable receipt printing

## Deployment

### Auto-updates
The application includes auto-update functionality using Electron Builder. Updates are distributed through:
- GitHub Releases
- Private update servers
- CDN distribution

### Platform-specific Builds
- **Windows**: MSI/EXE installers with auto-updater
- **macOS**: DMG packages with code signing
- **Linux**: AppImage and DEB packages

## Hardware Integration

### Supported Devices
- **Receipt Printers**: ESC/POS compatible printers
- **Barcode Scanners**: USB and Bluetooth scanners
- **Cash Drawers**: Standard POS cash drawer interfaces
- **Card Readers**: Integration with payment terminals

### Configuration
Hardware settings are configured through the main SaaS platform and synchronized to the POS application.

## Security

### Data Protection
- Encrypted local storage for sensitive data
- Secure IPC communication between processes
- Certificate pinning for API communications

### Authentication
- Multi-factor authentication support
- Session timeout and automatic logout
- Secure token storage and management

## Contributing

1. Follow the existing code style and architecture patterns
2. Write comprehensive tests for new features
3. Update documentation for API changes
4. Ensure cross-platform compatibility

## Troubleshooting

### Common Issues

**Application won't start**
- Check Node.js version compatibility
- Verify all dependencies are installed
- Check for port conflicts (default: 3000)

**API connection fails**
- Verify API_BASE_URL configuration
- Check network connectivity
- Validate authentication tokens

**Hardware not detected**
- Ensure device drivers are installed
- Check USB permissions on Linux/macOS
- Verify device compatibility

## License

This project is part of the SaaS Platform and follows the same licensing terms.
