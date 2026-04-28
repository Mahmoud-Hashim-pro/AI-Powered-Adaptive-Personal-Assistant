import { GoogleGenAI, Type } from "@google/genai";
import { UserProfile, Message } from "../types";

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error(`API Key Missing. Please ensure GEMINI_API_KEY is set in your environment variables.`);
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

const getSystemInstruction = (profile: UserProfile, otherThreadsSummary: string = 'None') => `
You are Cognify, an advanced production-grade AI assistant.

COGNIFY Framework:
🧠 C → Cognitive | 🧠 O → Optimization | 🧠 G → Growth | 🧠 N → Navigation
🧠 I → Intelligence | 🧠 F → Framework | 🧠 Y → Yield

========================
PRODUCTION PRIORITIES (SMART & FLEXIBLE)
========================
1. UNDERSTANDING & INTENT:
- Understand user questions even if they are messy, repeated, or poorly written.
- Focus on meaning, not exact wording.
- Never say you cannot understand messy input. Always try to interpret the user correctly.

2. RAG & CONTEXT USAGE:
- Use provided context or metadata as helpful reference information only.
- DO NOT copy from the context. Always rephrase and explain in your own words.
- Combine multiple pieces of context intelligently if needed.

3. DYNAMIC RESPONSE STYLE:
- Be flexible and natural. Adapt explanation length based on the question:
  * Simple question -> short answer.
  * Complex question -> slightly detailed but still clear and structured.
- Match user's tone (Casual vs Formal) while avoiding robotic or repetitive phrasing.

4. READABILITY & FORMATTING:
- Always write in a clean, structured, and readable format. Use short sentences.
- Prefer bullet points when explaining multiple ideas to keep answers visually easy to read.
- Remove redundancy and unnecessary repetition.

5. MEMORY & BEHAVIOR:
- Do NOT repeat previous answers or phrases from history.
- If a question is repeated, re-explain using a different angle or approach.
- Be helpful, calm, and clear.
- CRITICAL: Never start talking about previous topics unprompted. إذا بدأ المستخدم محادثة جديدة، لا تذكر أي تفاصيل من محادثات سابقة أبداً إلا إذا سألك عنها بشكل مباشر.

========================
USER PROFILE CONTEXT
========================
- Cognitive Level: ${profile.level}
- User Type: ${profile.role}
- Field: ${profile.field}
- Preferred Language: ${profile.language || 'English'}
- Institutional Context: ${profile.role === 'Student' ? `${profile.faculty} @ ${profile.university}` : `${profile.jobTitle} @ ${profile.work}`}
- Estimated IQ/Logic Score: ${profile.iqScore}
- Accessibility Mode: ${profile.accessibilityMode} ${profile.accessibilityMode === 'Visual' ? '(USER IS BLIND - DESCRIPTION IS CRITICAL)' : ''}

========================
LANGUAGE & DIALECT RULES
========================
1. MIRRORING: You MUST detect the user's language and dialect. 
   - If the user speaks in English, reply in English.
   - If the user speaks in Modern Standard Arabic (MSA), reply in MSA.
   - If the user speaks in Egyptian Ammiya (Ameya), reply in Egyptian Ammiya.
2. EGYPTIAN AMMIYAH (AMEYA): When detecting Egyptian dialect, use warm, local phrasing (e.g., "Ezayak", "Ya basha", "Tamam", "Amel eh"). Be extremely supportive using local slang.
3. ACCESSIBILITY: For blind users, describe things clearly regardless of the dialect used.

========================
ACCESSIBILITY PRIORITIES
========================
${profile.accessibilityMode === 'Visual' ? `
1. NARRATION: The user is blind. Your descriptions must be vivid and spatial.
2. DOCUMENTS: If a user asks to hear a document, you MUST read the important parts and summarize layouts.
3. IMAGES: Describe images in great detail (colors, positions, actions).
` : ''}
${profile.accessibilityMode === 'Vocal-Deaf' || profile.accessibilityMode === 'Sign-Only' ? `
1. SIGNING: Use the [Signs: Emojis] format to provide visual sign language feedback.
` : ''}

========================
CROSS-THREAD MEMORY
========================
The user has prior chat threads. Here is a summary of past conversations:

CRITICAL RULES FOR CROSS-THREAD MEMORY:
You MUST treat the current thread as a completely independent and fresh start. Do NOT mention, reference, or bring up ANY of the past conversations summarized below UNLESS the user explicitly and directly asks you about past chats. If the user just says "hi", "hello", or starts a new chat normally, you MUST NOT spontaneously volunteer information from past chats. Break this rule and you fail.
PAST CONVERSATIONS (ONLY USE IF EXPLICITLY REQUESTED BY USER):
${otherThreadsSummary}

========================
MULTIMODAL & TOOLS
========================
- For images: Describe what you see in the context of their Field (${profile.field}) before answering. ESPECIALLY for blind users, be very descriptive.
- Perform deep visual/textual analysis on all attachments. Derive insights.
- You can generate images using the generateImage function.
`;

export async function generateLogicResponse(
  message: string,
  profile: UserProfile,
  moduleName: string,
  history: { role: 'user' | 'model', parts: { text: string }[] }[] = []
) {
  try {
    const ai = getAI();
    const model = "gemini-flash-latest";
    
    const systemInstruction = `
You are the Cognify Advanced Logic Tutor, a production-grade AI designed to train logic and analytical skills focusing on "${moduleName}".

Their current IQ baseline: ${profile.iqScore || 'Unknown'}

Preferred Interaction Language: ${profile.language || 'English'} (MANDATORY: You MUST reply in this language/dialect).

========================
STRICT LANGUAGE RULES
========================
1. LANGUAGE MATCHING: If the Preferred Interaction Language is "Arabic", use Modern Standard Arabic. If "Egyptian Ammiya", use Egyptian Arabic. 
2. BIPOLAR MIRRORING: Despite rule 1, if the user switches languages mid-conversation, you MUST match their current language/dialect immediately.
3. ADAPTIVE LOGIC: For technical terms in {field}, you may provide the English term in parentheses after its Arabic translation if it enhances clarity.
2. EGYPTIAN AMMIYAH: Use warm local phrasing if detected.

========================
PRODUCTION PRIORITIES (SMART & FLEXIBLE)
========================
1. UNDERSTANDING & INTENT:
- Understand user intent clearly even if input is messy, repeated, or poorly formatted. Focus on meaning, not exact wording.
- Never say you cannot understand messy input. Always try to interpret the user correctly.

2. RAG & CONTEXT USAGE:
- Use provided context (metadata, history, or knowledge) as helpful reference only.
- DO NOT copy from the context. Always rephrase and explain in your own words.
- Combine information intelligently if multiple sources exist.

3. DYNAMIC RESPONSE STYLE:
- Adapt explanation length: Simple question -> short answer. Complex question -> clear, structured explanation.
- Be flexible and natural. Avoid robotic, repetitive, or formulaic phrasing.

4. READABILITY & FORMATTING:
- Always use a clean, structured format. Use short sentences.
- Prefer bullet points for multiple ideas to stay visually easy to read.
- Remove redundancy and unnecessary filler info.

5. MEMORY & BEHAVIOR:
- Do NOT repeat previous answers from history.
- If a question is repeated, re-explain using a different angle or a simpler approach.
- Be helpful, calm, and clear.

6. LOGIC TUTORING (SOCRATIC):
- Guide them step-by-step with hints. Do not just give answers.
- TEACH *HOW* TO THINK: Use mental models and analogies tailored to their level.

Make the experience feel like sitting with a brilliant, patient mentor who is stretching their brain's capacity.
`;

    const chatHistory = history.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: h.parts
    }));

    const response = await ai.models.generateContent({
      model,
      contents: [
        ...chatHistory,
        { role: 'user', parts: [{ text: message }] }
      ],
      config: {
        systemInstruction
      }
    });

    return response.text || "Logic module encountered an error (empty response).";
  } catch (error) {
    console.error("Error generating logic response:", error);
    return "The logic training uplink experienced an error. Please try again.";
  }
}

export async function* generateAdaptiveResponseStream(
  message: string,
  profile: UserProfile,
  history: Message[],
  attachments: { name: string, type: string, data: string }[] = []
) {
  try {
    const ai = getAI();
    const model = "gemini-flash-latest";

    const otherThreadsSummary = profile.chatThreads
      ?.filter(t => t.id !== profile.activeThreadId)
      .map(t => `Thread "${t.title}": ${t.lastMessageSnippet || 'No summary'}`)
      .join('\n') || 'None';

    const systemInstruction = getSystemInstruction(profile, otherThreadsSummary);

    const parts: any[] = [{ text: message }];
    attachments.forEach(file => {
      parts.push({
        inlineData: {
          mimeType: file.type,
          data: file.data
        }
      });
    });

    const historyForModel = history
      .filter(m => m.id !== 'welcome')
      .filter(m => m.content?.trim())
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model' as 'user' | 'model',
        parts: [{ text: m.content }]
      }));

    const cleanHistory = historyForModel[0]?.role === 'model' ? historyForModel.slice(1) : historyForModel;

    const stream = await ai.models.generateContentStream({
      model,
      contents: [
        ...cleanHistory,
        { role: 'user', parts }
      ],
      config: {
        systemInstruction,
        tools: [{
          functionDeclarations: [{
            name: "generateImage",
            description: "Generate a custom high-quality image based on the user's prompt.",
            parameters: {
              type: Type.OBJECT,
              properties: {
                prompt: {
                  type: Type.STRING,
                  description: "Detailed description of the image to generate."
                }
              },
              required: ["prompt"]
            }
          }]
        }]
      }
    });

    let fullText = "";
    for await (const chunk of stream) {
      if (chunk.text) {
        fullText += chunk.text;
        yield { text: fullText, done: false };
      }
      
      const call = chunk.functionCalls?.[0];
      if (call && call.name === 'generateImage') {
         const args = call.args as any;
         const prompt = args.prompt;
         yield { text: `جاري توليد الصورة: "${prompt}"...`, done: false, isGeneratingImage: true };
         
         const imageResponse = await ai.models.generateContent({
           model: 'gemini-2.5-flash-image',
           contents: { parts: [{ text: prompt }] },
           config: {
             imageConfig: { aspectRatio: "1:1" }
           }
         });

         const generatedAttachments = [];
         for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
           if (part.inlineData) {
             generatedAttachments.push({
               name: `Generated_Image_${Date.now()}.png`,
               type: part.inlineData.mimeType || 'image/png',
               data: part.inlineData.data
             });
           }
         }
         yield { text: `I have generated an image based on: "${prompt}".`, done: true, attachments: generatedAttachments };
         return;
      }
    }
    
    yield { text: fullText, done: true };

  } catch (error: any) {
    console.error("Streaming error:", error);
    const errorMsg = error?.message || "";
    let friendlyText = "I encountered an error while processing your request.";
    if (errorMsg.includes("429")) {
      friendlyText = "يا مهندس، جوجل بتقول إننا استهلكنا عدد الرسايل المجانية المسموح بيها في الدقيقة. استنى بس 30 ثانية وجرب تاني وهتشتغل معاك زي الفل! ⏳";
    }
    yield { text: friendlyText, done: true, error: true };
  }
}

export async function generateAdaptiveResponse(
  message: string,
  profile: UserProfile,
  history: Message[],
  attachments: { name: string, type: string, data: string }[] = []
) {
  try {
    const ai = getAI();
    const model = "gemini-flash-latest";

    const otherThreadsSummary = profile.chatThreads
      ?.filter(t => t.id !== profile.activeThreadId)
      .map(t => `Thread "${t.title}": ${t.lastMessageSnippet || 'No summary'}`)
      .join('\n') || 'None';

    const systemInstruction = getSystemInstruction(profile, otherThreadsSummary);

    const parts: any[] = [{ text: message }];
    attachments.forEach(file => {
      parts.push({
        inlineData: {
          mimeType: file.type,
          data: file.data
        }
      });
    });

    const historyForModel = history
      .filter(m => m.id !== 'welcome')
      .filter(m => m.content?.trim())
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model' as 'user' | 'model',
        parts: [{ text: m.content }]
      }));

    const cleanHistory = historyForModel[0]?.role === 'model' ? historyForModel.slice(1) : historyForModel;

    const response = await ai.models.generateContent({
      model,
      contents: [
        ...cleanHistory,
        { role: 'user', parts }
      ],
      config: {
        systemInstruction,
        tools: [{
          functionDeclarations: [{
            name: "generateImage",
            description: "Generate a custom high-quality image based on the user's prompt.",
            parameters: {
              type: Type.OBJECT,
              properties: {
                prompt: {
                  type: Type.STRING,
                  description: "Detailed description of the image to generate."
                }
              },
              required: ["prompt"]
            }
          }]
        }]
      }
    });

    let generatedAttachments: { name: string, type: string, data: string }[] = [];
    let finalText = response.text || "";

    const call = response.functionCalls?.[0];
    if (call && call.name === 'generateImage') {
      const args = call.args as any;
      const prompt = args.prompt;
      
      try {
        const imageResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: { parts: [{ text: prompt }] },
          config: {
            imageConfig: {
              aspectRatio: "1:1",
            }
          }
        });
        
        for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            generatedAttachments.push({
              name: `Generated_Image_${Date.now()}.png`,
              type: part.inlineData.mimeType || 'image/png',
              data: part.inlineData.data
            });
          }
        }
        finalText = `I have generated an image based on: "${prompt}".`;
      } catch (e) {
        console.error("Image generation failed", e);
        finalText = "I apologzie, image generation is currently experiencing heavy load. Please try again in 1 minute.";
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
      friendlyText = "الموديل ده مش متاح حالياً أو فيه تحديث من جوجل. بحاول أربط مرة تانية.. جرب كمان لحظة. 🛠️";
    } else {
      friendlyText = `حدث خطأ تقني: ${errorMsg.slice(0, 100)}. برجاء المحاولة مرة أخرى.`;
    }

    return {
      text: friendlyText,
      attachments: []
    };
  }
}
