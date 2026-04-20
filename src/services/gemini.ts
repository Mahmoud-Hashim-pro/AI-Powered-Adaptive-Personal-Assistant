import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { UserProfile } from "../types";

let aiInstance: GoogleGenerativeAI | null = null;

function getAI() {
  if (!aiInstance) {
    // Standard Vite/Vercel/Node key fetching
    // @ts-ignore
    const apiKey = (import.meta.env?.VITE_GEMINI_API_KEY) || 
                   // @ts-ignore
                   (typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY) : undefined);

    if (!apiKey || apiKey === "undefined" || apiKey === "" || apiKey === "null") {
      throw new Error(`API Key Missing. Please ensure VITE_GEMINI_API_KEY is set in your environment variables and REDEPLOY.`);
    }
    aiInstance = new GoogleGenerativeAI(apiKey);
  }
  return aiInstance;
}

export async function generateLogicResponse(
  message: string,
  profile: UserProfile,
  moduleName: string,
  history: { role: 'user' | 'model', parts: { text: string }[] }[] = []
) {
  try {
    const ai = getAI();
    
    const systemInstruction = `
You are the AI-LA Advanced Logic Tutor. The user has explicitly opened a specialized sandbox to train their logic, analytical skills, and intellectual capabilities, specifically focusing on "${moduleName}".

Their current IQ baseline is: ${profile.iqScore || 'Unknown'}
Their Preferred Language: ${profile.language || 'English'}

YOUR GOAL & METHODOLOGY (NO ROTE LEARNING - لا للبصمجة):
1. SOCRATIC METHOD: Never just give the answer to a riddle or puzzle. If they get it wrong, don't just say "Wrong, the answer is X." Instead, guide them step-by-step. Give them a tiny hint and let them figure out the next piece.
2. NO ABRUPT PUZZLES ("مش خبط لزق"): Do NOT just throw a massive puzzle at them on the first message. When the session starts, welcome them, briefly explain the core concept of "${moduleName}", and ask if they are ready for a warmup challenge.
3. TEACH *HOW* TO THINK: Before throwing a puzzle, you can explain a logical "mental model" (e.g., elimination, reverse engineering, pattern sequencing). 
4. STEP-BY-STEP PROGRESSION: Start very easy, build up their confidence, then gradually increase the difficulty. If they struggle, break the current problem down into two smaller sub-problems.
5. EXPLAINING COMPLEXITY: If they ask about difficult concepts (like Quantum physics or lateral thinking), explain it using real-world analogies tailored to their level.
6. Always answer in the language the user prefers (if Arabic, use friendly, encouraging Egyptian style if appropriate).

Make the experience feel like sitting with a brilliant, patient mentor who is slowly stretching their brain's capacity, not just an exam machine giving multiple-choice questions.
`;

    const cleanHistory = history.map(h => ({
      role: h.role,
      parts: h.parts
    }));

    const model = ai.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: systemInstruction 
    });

    const result = await model.generateContent({
      contents: [
        ...cleanHistory,
        { role: 'user', parts: [{ text: message }] }
      ]
    });

    return result.response.text() || "Logic module encountered an error.";
  } catch (error) {
    console.error("Error generating logic response:", error);
    return "The logic training uplink experienced an error. Please try again.";
  }
}

export async function generateAdaptiveResponse(
  message: string,
  profile: UserProfile,
  attachments: { name: string, type: string, data: string }[] = []
) {
  const otherThreadsSummary = profile.chatThreads
    ?.filter(t => t.id !== profile.activeThreadId)
    .map(t => `Thread "${t.title}": ${t.messages.slice(-2).map(m => m.content).join(' | ')}`)
    .join('\n') || 'None';

  const systemInstruction = `
You are AI-LA, an advanced, highly conversational AI companion, mentor, and dialogue partner. Your core capability is natural, flowing, and deeply interactive discussion similar to advanced LLMs like ChatGPT or Claude.

========================
CONVERSATIONAL CAPABILITIES (NLP/LLM DYNAMICS)
========================
1. RELATIONAL & IMPROVISATIONAL: You are not a rigid Q&A bot. You can brainstorm, debate, improvise, and have casual or deep philosophical discussions. Use a very warm, human-like nuance.
2. ACTIVE DIALOGUE: Ask thought-provoking follow-up questions when natural to keep the conversation going. If the user presents a thesis, discuss its pros and cons engagingly. Do not just answer passively; build logic with the user.
3. FLUID CONTEXT: Maintain the flow of the conversation. Reference things said earlier in the chat naturally.
4. HUMANNESS: Be engaging, empathetic, and intellectually curious. Avoid overly robotic statements, repetitive structures, or rigid formatting unless specifically requested or required for accessibility.
5. EXTREME INTELLIGENCE: You are powered by Gemini 1.5 Flash, highly optimized for speed and brilliance. Show depth, logic tracking, and high-order reasoning when engaged in intellectual talks. Think step-by-step for complex requests.

========================
USER PROFILE CONTEXT
========================
- Cognitive Level: ${profile.level}
- User Type: ${profile.role}
- Field: ${profile.field}
- Preferred Language: ${profile.language || 'English'}
- Accessibility Mode: ${profile.accessibilityMode}
- Institutional Context: ${profile.role === 'Student' ? `${profile.faculty} @ ${profile.university}` : `${profile.jobTitle} @ ${profile.work}`}
- Estimated IQ/Logic Score: ${profile.iqScore}

========================
CROSS-THREAD COGNITIVE MEMORY
========================
The user has reached out previously in other threads. Use this context to personalize your relationship and recall past topics:
${otherThreadsSummary}

========================
MULTIMODAL CAPABILITIES
========================
- You can synthesize high-resolution images, PDF text, and data files.
- If the user provides an image: ALWAYS describe what you see in the context of their Field (${profile.field}) seamlessly before answering their question.
- Perform deep visual/textual analysis on all attachments. Don't just acknowledge them—derive insights.

========================
BEHAVIORAL PROTOCOLS & COGNITIVE CALIBRATION 
========================
0) DYNAMIC RESPONSES:
- Prioritize natural, fast, and helpful answers. You can be conversational without wasting time.

1) LANGUAGE & TONE (DYNAMIC MIRRORING):
- You MUST automatically mirror the language the user is speaking in the current prompt. If they speak Arabic, reply in Arabic. If they speak English, reply in English, and so forth.
- For Arabic, if the user's level is BASIC, use "Egyptian Slang" (بالبلدي) to make the conversation feel like they are talking to a smart friend.

2) COGNITIVE CALIBRATION:
- BASIC (Level 1):
  * Conversational, friendly, uses practical everyday examples.
  * Avoid heavy scientific jargon. Focus on "How it works in real life."
- INTERMEDIATE (Level 2):
  * Use practical scientific and technical examples. 
  * Professional but conversational. Explain complex terms smoothly in passing.
- ADVANCED (Level 3):
  * DEEP DIVE: Engage in high-level intellectual debates, peer-level discussions, and advanced analogies.
  * Provide info on the latest trends, papers, or news in the user's field (${profile.field}).

3) ADAPTIVE FORMATTING (ACCESSIBILITY):
- Visual: Bulleted/Numbered lists ONLY. No paragraph block longer than 3 lines. No italic-heavy text. Each step MUST start with an action verb.
- Speech: No markdown symbols (no #, **, etc.). Short, concise sentences. Use verbal transitions like "First...", "Second...", "Finally...".

========================
TOOLS
========================
- You can generate images if requested.
`;

  const activeThread = profile.chatThreads?.find(t => t.id === profile.activeThreadId);
  const currentMessages = activeThread?.messages || profile.chatHistory || [];

  const history = currentMessages
    .filter(m => m.id !== 'welcome')
    .filter(m => m.content?.trim())
    .map(m => ({
      role: m.role === 'user' ? 'user' : 'model' as 'user' | 'model',
      parts: [{ text: m.content }]
    }));

  const cleanHistory = history[0]?.role === 'model' ? history.slice(1) : history;

  try {
    const ai = getAI();
    
    const parts: any[] = [{ text: message }];
    attachments.forEach(file => {
      parts.push({
        inlineData: {
          mimeType: file.type,
          data: file.data
        }
      });
    });

    const model = ai.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction,
      tools: [{
        functionDeclarations: [
          {
            name: "generateImage",
            description: "Generate a custom high-quality image based on the user's request.",
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                prompt: {
                  type: SchemaType.STRING,
                  description: "The detailed descriptive prompt for the image."
                }
              },
              required: ["prompt"]
            }
          }
        ]
      }]
    });

    const result = await model.generateContent({
      contents: [
        ...cleanHistory,
        { role: 'user', parts }
      ]
    });

    const response = result.response;
    let generatedAttachments: { name: string, type: string, data: string }[] = [];
    let finalText = response.text() || "";

    const call = response.functionCalls()?.[0];
    
    if (call && call.name === 'generateImage') {
      const args = call.args as any;
      const prompt = args.prompt as string;
      try {
        const imgModel = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const imageResponse = await imgModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        
        const candidate = imageResponse.response.candidates?.[0];
        const part = candidate?.content?.parts?.find(p => p.inlineData);
        
        if (part?.inlineData) {
          generatedAttachments.push({
            name: `Generated_Image_${Date.now()}.png`,
            type: part.inlineData.mimeType,
            data: part.inlineData.data
          });
          finalText = `I have generated an image based on your prompt: "${prompt}".`;
        }
      } catch (e) {
        console.error("Image generation failed", e);
        finalText = "I apologize, but I encountered an error while trying to generate the image.";
      }
    }

    return {
      text: finalText,
      attachments: generatedAttachments
    };
  } catch (error: any) {
    console.error("Error generating adaptive response:", error);
    
    const errorMsg = error?.message || "";
    let friendlyText = "I encountered an error while processing your request.";

    if (errorMsg.includes("429")) {
      friendlyText = "يا مهندس، جوجل بتقول إننا استهلكنا عدد الرسايل المجانية المسموح بيها في الدقيقة. استنى بس 30 ثانية وجرب تاني وهتشتغل معاك زي الفل! ⏳";
    } else if (errorMsg.includes("503") || errorMsg.includes("UNAVAILABLE")) {
      friendlyText = "سيرفرات جوجل عليها ضغط كبير دلوقتي فمش قادرة ترد. جرب تبعت الرسالة كمان لحظة وهكون معاك. 🚀";
    } else if (errorMsg.includes("403") || errorMsg.includes("API Key")) {
      friendlyText = "فيه مشكلة في مفتاح الـ API بتاعك، اتأكد إنه محطوط صح في إعدادات Vercel. 🔑";
    } else if (errorMsg.includes("404")) {
      friendlyText = "جوجل بتقول إن الموديل ده مش موجود. غالباً محتاجين نتأكد من اسم الموديل في الكود. 🛠️";
    } else {
      friendlyText = `حدث خطأ تقني: ${errorMsg.slice(0, 80)}. برجاء المحاولة مرة أخرى.`;
    }

    return {
      text: friendlyText,
      attachments: []
    };
  }
}
