import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('Dashboard crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <div className="crash-card">
            <div className="crash-art">⚠️</div>
            <h2>Something went wrong rendering the dashboard</h2>
            <p>{String(this.state.error?.message || this.state.error)}</p>
            <button className="btn btn-primary" onClick={() => window.location.assign('/')}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
