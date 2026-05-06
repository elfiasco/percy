import { registerChartRenderer }       from "./ChartRenderer"
import { registerTableRenderer }       from "./TableRenderer"
import { registerConnectorRenderer }   from "./ConnectorRenderer"
import { registerTiptapTextRenderer }  from "./TiptapTextRenderer"

let _setup = false

export function setupNativeRenderers(): void {
  if (_setup) return
  _setup = true
  registerChartRenderer()
  registerTableRenderer()
  registerConnectorRenderer()
  registerTiptapTextRenderer()
}
