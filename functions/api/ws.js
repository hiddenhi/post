// 全局缓存唯一WS连接
let globalSocket = null;

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export default async function onRequest({ request }) {
  const upgrade = request.headers.get("Upgrade");
  if (!upgrade || upgrade !== "websocket") {
    return Response.json({ code: 400, msg: "仅支持WebSocket连接" }, { status: 400 });
  }

  const [client, server] = new WebSocketPair();
  server.accept();

  // 覆盖旧连接
  if (globalSocket) {
    try {
      globalSocket.close(1000, "新客户端接入，断开旧连接");
    } catch (e) {}
  }
  globalSocket = server;

  // 监听普通业务消息（不再处理自定义ping）
  server.addEventListener("message", (e) => {
    try {
      // 仅打印普通业务消息，原生Ping帧不会进入这里
      console.log("客户端业务消息：", e.data);
    } catch {}
  });

  // 连接断开清空缓存
  server.addEventListener("close", () => {
    if (globalSocket === server) globalSocket = null;
  });

  return new Response(null, { status: 101, webSocket: client });
}

// 对外导出推送方法，给submit接口调用
export function sendToWSClient(data) {
  if (!globalSocket || globalSocket.readyState !== WebSocket.OPEN) return false;
  try {
    globalSocket.send(JSON.stringify({
      type: "form_data",
      data
    }));
    return true;
  } catch (err) {
    globalSocket = null;
    return false;
  }
}
