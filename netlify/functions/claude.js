// Netlify Edge Function: Anthropic API 프록시
// 브라우저에는 절대 API 키가 노출되지 않습니다. 키는 Netlify 환경변수(ANTHROPIC_API_KEY)에만 저장됩니다.
//
// 기존 netlify/functions/claude.js(일반 서버리스 함수)에서 Edge Function으로 전환.
// 초고 생성처럼 응답 시간이 긴 호출에서도 10초 타임아웃에 걸리지 않도록 하기 위함.

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
      JSON.stringify({
        error: "서버에 ANTHROPIC_API_KEY가 설정되어 있지 않습니다. Netlify 환경변수를 확인하세요.",
      }),
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
  path: "/api/claude",
};
