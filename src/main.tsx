import { createRoot } from 'react-dom/client';
import { Component, type ReactNode } from 'react';
import App from './App';
import './styles.css';
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <main className="fatal"><h1>书房暂时无法打开</h1><p>{this.state.error}</p><p>请尝试重新打开应用；不要清除浏览器数据，以免丢失本地书籍。</p><button onClick={() => location.reload()}>重新打开</button></main> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App/></ErrorBoundary>);
