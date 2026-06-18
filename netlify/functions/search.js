// Netlify Edge Function: 웹 검색 기능을 포함한 Anthropic API 호출
// 리서치/검증 단계에서 사용. Claude의 web_search 도구를 사용해 최신 자료를 찾고 출처를 함께 반환합니다.
//
// 기존에는 netlify/functions/search.js (일반 서버리스 함수)였으나,
// 일반 서버리스 함수는 무료/Personal 플랜에서 10초, Pro 플랜에서도 별도 활성화 없이는
// 여전히 10초 제한이 걸려 있어 웹 검색을 포함한 Claude 응답 생성 시간(보통 10~30초)을
// 넘기면 504 Gateway Timeout이 발생했다.
// Edge Function은 이런 짧은 동기 타임아웃 제한이 없어 이 문제를 근본적으로 피할 수 있다.

export default async (request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (request.method === "OPTIONS") {
    return new Response("", { status: 200, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST만 허용됩니다." }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "서버에 ANTHROPIC_API_KEY가 설정되어 있지 않습니다." }),
      { status: 500, headers: corsHeaders }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "잘못된 요청 본문입니다." }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { query, instruction } = payload;
  if (!query) {
    return new Response(JSON.stringify({ error: "query가 필요합니다." }), {
      status: 400,
      headers: corsHeaders,
    });
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
      return new Response(
        JSON.stringify({ error: data.error?.message || "Anthropic API 오류", detail: data }),
        { status: response.status, headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
};

export const config = {
  path: "/api/search",
};
