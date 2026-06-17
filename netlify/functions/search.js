// Netlify Function: 웹 검색 기능을 포함한 Anthropic API 호출
// 리서치/검증 단계에서 사용. Claude의 web_search 도구를 사용해 최신 자료를 찾고 출처를 함께 반환합니다.

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
      body: JSON.stringify({ error: "서버에 ANTHROPIC_API_KEY가 설정되어 있지 않습니다." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "잘못된 요청 본문입니다." }) };
  }

  const { query, instruction } = payload;
  if (!query) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "query가 필요합니다." }) };
  }

  try {
    const requestBody = {
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content:
            instruction ||
            `다음 주제에 대해 웹에서 최신 정보를 검색하고, 핵심 사실과 출처 URL을 한국어로 정리해줘. 주제: ${query}`,
        },
      ],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    };

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
