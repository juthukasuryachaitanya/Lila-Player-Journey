import { Component, Fragment } from 'react'

// Contains any rendering exception thrown inside the map (e.g. the rare pan/zoom
// crash) so it degrades to a recoverable card instead of blanking the whole app.
export default class MapErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false, nonce: 0 }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    // keep a trace for debugging, but never let it bubble up and unmount the app
    console.error('Map view error (contained by boundary):', error, info)
  }

  reset = () => this.setState((s) => ({ failed: false, nonce: s.nonce + 1 }))

  render() {
    if (this.state.failed) {
      return (
        <div className="map-fallback">
          <div className="map-fallback-card">
            <div className="map-fallback-title">Map view hit a snag</div>
            <p>The renderer ran into a hiccup. Your data, filters and selection are all intact.</p>
            <button onClick={this.reset}>Reset map view</button>
          </div>
        </div>
      )
    }
    // changing the key force-remounts the map subtree with fresh state on reset
    return <Fragment key={this.state.nonce}>{this.props.children}</Fragment>
  }
}
