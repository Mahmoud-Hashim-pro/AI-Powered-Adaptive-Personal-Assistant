import { GoogleGenAI } from "@google/genai";

async function test() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Hello",
    });
    console.log("3.1-pro-preview Success:", response.text);
  } catch (e) {
    console.error("3.1-pro-preview Error:", e.message);
  }
}

test();
