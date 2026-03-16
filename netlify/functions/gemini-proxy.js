exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { contents } = JSON.parse(event.body);
    const API_KEY = process.env.VITE_GEMINI_API_KEY;
    const MODEL = "gemini-2.5-flash-lite";
    const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

    const response = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Gemini API error");
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error("Proxy Error:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Failed to fetch from Gemini",
        details: error.message
      }),
    };
  }
};
