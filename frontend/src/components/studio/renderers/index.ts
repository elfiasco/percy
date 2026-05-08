import { registerChartRenderer }          from "./ChartRenderer"
import { registerConnectorRenderer }      from "./ConnectorRenderer"
import { registerTiptapTextRenderer }     from "./TiptapTextRenderer"
import { registerTiptapTableRenderer }    from "./TiptapTableRenderer"
import { registerBridgeShapeRenderer }    from "./BridgeShapeRenderer"
import { registerBridgeImageRenderer }    from "./BridgeImageRenderer"
import { registerBridgeFreeformRenderer } from "./BridgeFreeformRenderer"
import { registerBridgeGroupRenderer }    from "./BridgeGroupRenderer"

let _setup = false

export function setupNativeRenderers(): void {
  if (_setup) return
  _setup = true
  registerChartRenderer()
  registerConnectorRenderer()
  registerTiptapTextRenderer()
  registerTiptapTableRenderer()
  registerBridgeShapeRenderer()
  registerBridgeImageRenderer()
  registerBridgeFreeformRenderer()
  registerBridgeGroupRenderer()
}
