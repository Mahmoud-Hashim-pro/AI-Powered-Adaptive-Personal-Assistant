import { GoogleGenAI, Type } from "@google/genai";
import { UserProfile } from "../types";

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    // Vite's standard way is import.meta.env.
    // We also check process.env as a fallback for some environments.
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || 
                   // @ts-ignore
                   (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined) ||
                   // @ts-ignore
                   (typeof process !== 'undefined' ? process.env.VITE_GEMINI_API_KEY : undefined);

    if (!apiKey || apiKey === "undefined" || apiKey === "" || apiKey === "null") {
      throw new Error(`API Key Missing. Found: ${apiKey}. Please ensure VITE_GEMINI_API_KEY is set in Vercel Settings and then trigger a REDEPLOY.`);
    }
    aiInstance = new GoogleGenAI({ apiKey });
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

    // ✅ Fix: تأكد إن history مش بيبدأ بـ 'model'
    const cleanHistory = history[0]?.role === 'model'
      ? history.slice(1)
      : history;

    const parts = [{ text: message }];

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        ...cleanHistory,
        { role: 'user', parts }
      ],
      config: {
        systemInstruction
      }
    });

    return response.text || "Logic module encountered an error.";
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
5. EXTREME INTELLIGENCE: You are powered by Gemini 2.5 Flash, highly optimized for speed and brilliance. Show depth, logic tracking, and high-order reasoning when engaged in intellectual talks. Think step-by-step for complex requests.

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
- You can synthesize high-resolution images, videos, PDF text, and data files.
- If the user provides a video: Analyze the events, timeframe, and visual elements in the video sequence accurately, linking them to their registered Field if possible.
- If the user provides an image: ALWAYS describe what you see in the context of their Field (${profile.field}) seamlessly before answering their question.
- Perform deep visual/textual analysis on all attachments. Don't just acknowledge them—derive insights.

========================
BEHAVIORAL PROTOCOLS & COGNITIVE CALIBRATION 
========================
0) DYNAMIC RESPONSES:
- Prioritize natural, fast, and helpful answers. You can be conversational without wasting time.

1) LANGUAGE & TONE (DYNAMIC MIRRORING):
- You MUST automatically mirror the language the user is speaking in the current prompt. If they speak Arabic, reply in Arabic. If they speak English, reply in English, and so forth.
- The "Preferred Language" parameter (${profile.language || 'English'}) should only act as a fallback if the user's language is ambiguous or if they ask you a general request without a clear language preference.
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
- Sign-support: Sentences MUST be under 12 words. No idioms, metaphors, or culturally ambiguous phrases. Use imperative verbs.

4) GROWTH ENGINE (GENTLE GUIDANCE):
- Instead of strictly rewriting questions, if the user asks a very vague *technical* question, gently guide them to clarify. Only offer tips if it naturally fits the conversation. 

5) CAREER SHIFT / OUT-OF-FIELD QUERIES (ANY FIELD):
- Compare the user's field (${profile.field}) and profession (${profile.role === 'Student' ? profile.faculty : profile.jobTitle}) with the topic they are asking about.
- If they are asking about ANY completely different field (e.g., a Civil Engineer asking about Programming, a Doctor asking about Marketing, an Accountant asking about Graphic Design):
  a) CONVERSATION FIRST: Acknowledge the career shift enthusiastically. Chat with them a bit first to understand their motivation before dumping information.
  b) BEGINNER MODE: Switch to absolute beginner mode for this new topic. Explain from absolute zero, step-by-step, with extreme simplicity and basic analogies. Do not assume prior knowledge in this new area.
  c) PRE-ASSESSMENT OFFER: After the initial brief chat, explicitly offer to give them a "short quick quiz" or "small test" to gauge their current level in this new field so you know exactly where to start. You MUST wait for their agreement before giving the quiz or diving into a heavy technical roadmap.

CURRENT MODE SUMMARY:
- Accessibility: ${profile.accessibilityMode}
- Cognitive Level: ${profile.level}
- Language: ${profile.language || 'English'}
`;

  const activeThread = profile.chatThreads?.find(t => t.id === profile.activeThreadId);
  const currentMessages = activeThread?.messages || profile.chatHistory || [];

  // ✅ Fix: احذف welcome message وأي messages فاضية
  const history = currentMessages
    .filter(m => m.id !== 'welcome')
    .filter(m => m.content?.trim())
    .map(m => ({
      role: m.role === 'user' ? 'user' : 'model' as 'user' | 'model',
      parts: [{ text: m.content }]
    }));

  // ✅ Fix: تأكد إن history مش بيبدأ بـ 'model'
  const cleanHistory = history[0]?.role === 'model'
    ? history.slice(1)
    : history;

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

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        ...cleanHistory,
        { role: 'user', parts }
      ],
      config: {
        systemInstruction,
        tools: [{
          functionDeclarations: [
            {
              name: "generateImage",
              description: "Generate a custom high-quality image based on the user's request. Only use this if the user EXPLICITLY asks to generate, create, or draw an image/picture.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  prompt: {
                    type: Type.STRING,
                    description: "The detailed descriptive prompt for the image."
                  }
                },
                required: ["prompt"]
              }
            },
            {
              name: "generateVideo",
              description: "Generate a short video animation. Only use this if the user EXPLICITLY asks to generate or create a video/animation.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  prompt: {
                    type: Type.STRING,
                    description: "The detailed descriptive prompt for the video."
                  }
                },
                required: ["prompt"]
              }
            }
          ]
        }]
      }
    });

    let generatedAttachments: { name: string, type: string, data: string }[] = [];
    let finalText = response.text || "";

    if (response.functionCalls && response.functionCalls.length > 0) {
      const call = response.functionCalls[0];
      
      if (call.name === 'generateImage') {
        const prompt = call.args.prompt as string;
        try {
          const imageResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: prompt }] },
            config: {
              imageConfig: { aspectRatio: "16:9" }
            }
          });
          
          for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
              generatedAttachments.push({
                name: `Generated_Image_${Date.now()}.png`,
                type: 'image/png',
                data: part.inlineData.data
              });
            }
          }
          finalText = `I have generated an image based on your prompt: "${prompt}".`;
        } catch (e) {
          console.error("Image generation failed", e);
          finalText = "I apologize, but I encountered an error while trying to generate the image.";
        }
      } else if (call.name === 'generateVideo') {
        const prompt = call.args.prompt as string;
        try {
          let operation = await ai.models.generateVideos({
            model: 'veo-3.1-lite-generate-preview',
            prompt: prompt,
            config: {
              numberOfVideos: 1,
              resolution: '1080p',
              aspectRatio: '16:9'
            }
          });
          
          // Poll for completion
          while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 8000));
            operation = await ai.operations.getVideosOperation({operation});
          }
          
          const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
          if (downloadLink) {
             const apiKey = process.env.GEMINI_API_KEY!;
             const vidResponse = await fetch(downloadLink, {
               method: 'GET',
               headers: { 'x-goog-api-key': apiKey },
             });
             const blob = await vidResponse.blob();
             const buffer = await blob.arrayBuffer();
             const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

             generatedAttachments.push({
               name: `Generated_Video_${Date.now()}.mp4`,
               type: 'video/mp4',
               data: base64
             });
             finalText = `I have successfully generated your video based on: "${prompt}".`;
          } else {
             finalText = "Video generation completed but the video uri was not found.";
          }
        } catch (e: any) {
          console.error("Video generation failed", e);
          if (e.message && e.message.includes('403')) {
            finalText = "I apologize, but video generation requires a paid Google Cloud API Key with billing enabled. The current built-in key does not support the 'Veo' model.";
          } else {
            finalText = "I apologize, but I encountered an error. Note that video generation can be highly intensive or occasionally fail due to system load. Please try again later.";
          }
        }
      }
    }

    return {
      text: finalText,
      attachments: generatedAttachments
    };
  } catch (error: any) {
    console.error("Error generating adaptive response:", error);
    const errorMsg = error?.message || "Unknown error";
    return `I encountered an error. Technical details: ${errorMsg}. Please ensure your API key is correctly set in Vercel.`;
  }
}
