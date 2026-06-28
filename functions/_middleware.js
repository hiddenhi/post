export async function onRequest({ request, next }) {
  // 预检OPTIONS直接返回204，不进入接口逻辑
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS,GET",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400"
      }
    })
  }
  // 正常请求放行到接口
  const res = await next()
  // 所有响应附加跨域头
  res.headers.set("Access-Control-Allow-Origin", "*")
  return res
}
