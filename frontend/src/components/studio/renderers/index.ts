import { registerChartRenderer }        from "./ChartRenderer"
import { registerConnectorRenderer }    from "./ConnectorRenderer"
import { registerTiptapTextRenderer }   from "./TiptapTextRenderer"
import { registerTiptapTableRenderer }  from "./TiptapTableRenderer"
import { registerTiptapShapeRenderer }  from "./TiptapShapeRenderer"

let _setup = false

export function setupNativeRenderers(): void {
  if (_setup) return
  _setup = true
  registerChartRenderer()
  registerConnectorRenderer()
  registerTiptapTextRenderer()
  registerTiptapTableRenderer()
  registerTiptapShapeRenderer()
}
