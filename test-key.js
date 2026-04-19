import { GoogleGenAI } from "@google/genai";

async function test() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if(!apiKey) {
       console.log("No key found in process.env.GEMINI_API_KEY");
       return;
    }
    
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: "Hello",
    });
    console.log("3.1-pro-preview Success:", response.text);
  } catch (e) {
    console.error("3.1-pro-preview Error:", e.message);
  }
}

test();