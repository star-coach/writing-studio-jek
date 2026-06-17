// Netlify Function: Anthropic API 프록시
// 브라우저에는 절대 API 키가 노출되지 않습니다. 키는 Netlify 환경변수(ANTHROPIC_API_KEY)에만 저장됩니다.

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "POST만 허용됩니다." }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "서버에 ANTHROPIC_API_KEY가 설정되어 있지 않습니다. Netlify 환경변수를 확인하세요." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "잘못된 요청 본문입니다." }) };
  }

  const { messages, system, max_tokens, model, tools } = payload;

  try {
    const requestBody = {
      model: model || "claude-sonnet-4-6",
      max_tokens: max_tokens || 4096,
      messages: messages || [],
    };
    if (system) requestBody.system = system;
    if (tools) requestBody.tools = tools;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: data.error?.message || "Anthropic API 오류", detail: data }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
