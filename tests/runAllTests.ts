/**
 * Cognify 2.0 Automated Verification Suite (Points 21 & 22)
 * Tests core pedagogical, mathematical, and architectural engines.
 */

import crypto from 'crypto';
import { calculateNormalizedGain } from '../src/lib/evaluationEngine.js';
import { getConcept, diagnosePrerequisiteGap, detectConceptFromText } from '../src/lib/conceptGraph.js';
import { checkRateLimit } from '../api/_lib/rateLimiter.js';
import { validateAndSanitizeResponse } from '../api/_lib/qualityGuard.js';
import { calculateNextReview, createInitialRetentionSchedule } from '../src/lib/spacedRetention.js';
import { resolveCognitiveStage, guard, buildPersona } from '../api/_lib/ai.js';
import { verifyRequestAuth, setTestCertProvider, getExpectedProjectId } from '../api/_lib/authGuard.js';
import { eventBus } from '../src/lib/learningEvents.js';
import { getStudentStateManager } from '../src/lib/studentStateEngine.js';
import { classifyRequest } from '../api/_lib/router.js';
import {
  extractSpatialObjectsFromVision,
  saveSpatialObject,
  getSpatialObjects,
  querySpatialMemory,
} from '../src/lib/spatialMemoryEngine.js';
import { localize } from '../src/lib/translations.js';
import { canAccessView } from '../src/lib/access.js';
import {
  getDatabaseHealth,
  getCollectionStats,
  generateFullSystemBackupJson,
  cleanStaleSessionsAndCache,
  generateDatabaseAuditReport,
} from '../src/lib/databaseHub.js';
import { resolveClientIp, logSecurityEvent } from '../src/lib/securityTracker.js';

let totalPassed = 0;
let totalFailed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    totalPassed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    totalFailed++;
  }
}

async function run() {
  console.log('\n--- Running Cognify 2.0 Hardened Test Suite ---');

  // 1. Evaluation Engine & Hake's Gain Tests
  console.log('\n[1] Evaluation Engine (Hake Normalized Gain)');
  {
    const g1 = calculateNormalizedGain(40, 70);
    assert(Math.abs(g1 - 0.5) < 0.001, 'Standard gain calculation (40% to 70% -> g=0.5)');

    const g2 = calculateNormalizedGain(100, 100);
    assert(g2 === 1.0, 'Initial 100% score maintained -> g=1.0');

    const g3 = calculateNormalizedGain(80, 60);
    assert(g3 < 0 && g3 >= -1.0, 'Regression properly returns negative gain');
  }

  // 2. Concept Graph & Root-Cause Diagnosis Tests
  console.log('\n[2] Concept Graph & Prerequisite Diagnosis');
  {
    const pointers = getConcept('pointers');
    assert(!!pointers && pointers.prerequisites.includes('memory_addresses'), 'Concept registry contains valid nodes & prerequisites');

    const mockMastery = {
      pointers: { accuracy: 0.4, attempts: 5, confidence: 0.3 },
    };
    const diagnosis = diagnosePrerequisiteGap('dynamic_memory', mockMastery as any);
    assert(diagnosis.hasPrerequisiteGap === true, 'Correctly flags prerequisite gap');
    assert(diagnosis.rootGapConcept?.id === 'pointers', 'Accurately diagnoses pointers as the root stumbling block');

    const masteredMastery = {
      pointers: { accuracy: 0.9, attempts: 10, confidence: 0.95 },
      heap_stack: { accuracy: 0.85, attempts: 6, confidence: 0.9 },
    };
    const healthyDiagnosis = diagnosePrerequisiteGap('dynamic_memory', masteredMastery as any);
    assert(healthyDiagnosis.hasPrerequisiteGap === false, 'Recognizes when prerequisites are properly mastered');
  }

  // 3. Spaced Repetition (SM-2) Tests
  console.log('\n[3] Spaced Repetition (Ebbinghaus Intervals)');
  {
    const initial = createInitialRetentionSchedule('pointers');
    assert(initial.intervalDays === 1, 'Initial interval is 1 day');

    const rep1 = calculateNextReview(initial, 5);
    assert(rep1.repetitions === 1 && rep1.status === 'learning', 'First repetition transitions to learning');

    const rep2 = calculateNextReview(rep1, 5);
    assert(rep2.repetitions === 2 && rep2.intervalDays === 3, 'Second repetition interval is 3 days');

    const regressed = calculateNextReview(rep2, 1);
    assert(regressed.repetitions === 0 && regressed.status === 'regressed', 'Low quality score resets repetition counter');
  }

  // 4. Rate Limiter Tests (Dual-Tier: IP & User)
  console.log('\n[4] Rate Limiter (Dual-Tier: IP & User)');
  {
    const testIp = 'ip:192.168.1.100';
    const res1 = checkRateLimit(testIp, 3);
    assert(res1.allowed === true && res1.remaining === 2, 'Initial IP request allowed with decrementing remaining');
    checkRateLimit(testIp, 3);
    checkRateLimit(testIp, 3);
    const blocked = checkRateLimit(testIp, 3);
    assert(blocked.allowed === false && blocked.remaining === 0, 'Exceeding IP limit correctly blocks');

    const testUser = 'user:student_456';
    const userRes1 = checkRateLimit(testUser, 2);
    assert(userRes1.allowed === true && userRes1.remaining === 1, 'User quota tracked independently');
  }

  // 5. AI Output Quality Guard Tests
  console.log('\n[5] AI Output Quality Guard');
  {
    const brokenCode = 'Here is your solution:\n```python\nprint("hello world")';
    const fixedCode = validateAndSanitizeResponse(brokenCode);
    assert(fixedCode.text.endsWith('\n```'), 'Repairs unclosed code block');

    const brokenMath = 'Formula is $$ E = mc^2';
    const fixedMath = validateAndSanitizeResponse(brokenMath);
    assert(fixedMath.text.endsWith('$$'), 'Repairs unclosed LaTeX block');

    const emptyRes = validateAndSanitizeResponse('   ');
    assert(emptyRes.isValid === false, 'Catches empty response');
  }

  // 6. Scientific Cognitive Stage Resolution (Decoupled from IQ)
  console.log('\n[6] Scientific Cognitive Stage Resolution (Decoupled from IQ)');
  {
    assert(resolveCognitiveStage('Basic') === 'foundational', 'Basic maps to foundational');
    assert(resolveCognitiveStage('Intermediate') === 'developing', 'Intermediate maps to developing');
    assert(resolveCognitiveStage('Proficient') === 'proficient', 'Proficient maps to proficient');
    assert(resolveCognitiveStage('Advanced') === 'advanced', 'Advanced maps to advanced');
    assert(resolveCognitiveStage(undefined) === 'developing', 'Undefined defaults to developing baseline without IQ');
  }

  // 7. Hardened Authentication Guard (Complete 6-Case Matrix & Production Env Validation)
  console.log('\n[7] Hardened Authentication Guard (6-Case Matrix & Project Validation)');
  {
    const prevGeminiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-mock-gemini-key';

    function createMockRes() {
      const headers: Record<string, string> = {};
      return {
        statusCode: 200,
        body: null as any,
        headers,
        setHeader(name: string, val: string) {
          headers[name] = val;
          return this;
        },
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(data: any) {
          this.body = data;
          return this;
        },
      };
    }

    // Set up RSA key pairs for testing cryptographic verification
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const wrongKeyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const testKid = 'test-cert-kid-1';
    const projectId = getExpectedProjectId();

    function signTestJwt(header: any, payload: any, keyPem: string) {
      const h = Buffer.from(JSON.stringify(header)).toString('base64url');
      const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signer = crypto.createSign('RSA-SHA256');
      signer.update(`${h}.${p}`);
      const sig = signer.sign(keyPem, 'base64url');
      return `${h}.${p}.${sig}`;
    }

    // Register test public cert
    setTestCertProvider(async () => ({ [testKid]: publicKey }));

    try {
      const nowSec = Math.floor(Date.now() / 1000);

      // Case 1: No token -> 401
      const req1 = { method: 'POST', headers: {}, body: { uid: 'attacker_spoof_attempt' } };
      const res1 = createMockRes();
      const allowed1 = await guard(req1, res1);
      assert(!allowed1 && res1.statusCode === 401, 'Case 1: No token (body.uid spoof) -> 401 Unauthorized');

      // Case 2: Fake JWT -> 401
      const req2 = { method: 'POST', headers: { authorization: 'Bearer completely.fake.jwt' } };
      const res2 = createMockRes();
      const allowed2 = await guard(req2, res2);
      assert(!allowed2 && res2.statusCode === 401, 'Case 2: Fake JWT -> 401 Unauthorized');

      // Case 3: Wrong signature -> 401
      const wrongSigToken = signTestJwt(
        { alg: 'RS256', kid: testKid },
        {
          aud: projectId,
          iss: `https://securetoken.google.com/${projectId}`,
          sub: 'student_wrong_sig',
          user_id: 'student_wrong_sig',
          exp: nowSec + 3600,
          auth_time: nowSec,
        },
        wrongKeyPair.privateKey
      );
      const req3 = { method: 'POST', headers: { authorization: `Bearer ${wrongSigToken}` } };
      const res3 = createMockRes();
      const allowed3 = await guard(req3, res3);
      assert(!allowed3 && res3.statusCode === 401, 'Case 3: Wrong cryptographic signature -> 401 Unauthorized');

      // Case 4: Expired token -> 401
      const expiredToken = signTestJwt(
        { alg: 'RS256', kid: testKid },
        {
          aud: projectId,
          iss: `https://securetoken.google.com/${projectId}`,
          sub: 'student_expired',
          user_id: 'student_expired',
          exp: nowSec - 60,
          auth_time: nowSec - 3600,
        },
        privateKey
      );
      const req4 = { method: 'POST', headers: { authorization: `Bearer ${expiredToken}` } };
      const res4 = createMockRes();
      const allowed4 = await guard(req4, res4);
      assert(!allowed4 && res4.statusCode === 401, 'Case 4: Expired token -> 401 Unauthorized');

      // Case 5: Wrong project -> 401
      const wrongProjectToken = signTestJwt(
        { alg: 'RS256', kid: testKid },
        {
          aud: 'different-firebase-project',
          iss: `https://securetoken.google.com/${projectId}`,
          sub: 'student_wrong_proj',
          user_id: 'student_wrong_proj',
          exp: nowSec + 3600,
          auth_time: nowSec,
        },
        privateKey
      );
      const req5 = { method: 'POST', headers: { authorization: `Bearer ${wrongProjectToken}` } };
      const res5 = createMockRes();
      const allowed5 = await guard(req5, res5);
      assert(!allowed5 && res5.statusCode === 401, 'Case 5: Wrong project audience -> 401 Unauthorized');

      // Case 6: Valid Firebase RS256 token -> 200
      const validToken = signTestJwt(
        { alg: 'RS256', kid: testKid },
        {
          aud: projectId,
          iss: `https://securetoken.google.com/${projectId}`,
          sub: 'student_verified_200',
          user_id: 'student_verified_200',
          exp: nowSec + 3600,
          auth_time: nowSec,
        },
        privateKey
      );
      const req6 = { method: 'POST', headers: { authorization: `Bearer ${validToken}` } };
      const res6 = createMockRes();
      const allowed6 = await guard(req6, res6);
      if (allowed6) {
        res6.status(200).json({ ok: true, uid: (req6 as any).authenticatedUid });
      }
      assert(
        allowed6 === true && res6.statusCode === 200 && (req6 as any).authenticatedUid === 'student_verified_200',
        'Case 6: Valid Firebase RS256 token -> 200 OK'
      );
    } finally {
      // Clean up test cert provider
      setTestCertProvider(null);
    }

    // Production Project ID Validation: Ensure missing FIREBASE_PROJECT_ID in production throws
    const prevEnv = process.env.NODE_ENV;
    const prevProjectId = process.env.FIREBASE_PROJECT_ID;
    try {
      (process.env as any).NODE_ENV = 'production';
      delete process.env.FIREBASE_PROJECT_ID;
      let didThrow = false;
      try {
        getExpectedProjectId();
      } catch (err: any) {
        didThrow = true;
      }
      assert(didThrow === true, 'Production strictly requires FIREBASE_PROJECT_ID and throws if missing');
    } finally {
      (process.env as any).NODE_ENV = prevEnv;
      if (prevProjectId) process.env.FIREBASE_PROJECT_ID = prevProjectId;
      else delete process.env.FIREBASE_PROJECT_ID;
      if (prevGeminiKey) process.env.GEMINI_API_KEY = prevGeminiKey;
      else delete process.env.GEMINI_API_KEY;
    }
  }

  // 8. Closed-Loop Event Bus & Student State Engine
  console.log('\n[8] Closed-Loop Event Bus & Student State Engine');
  {
    const testUid = `student_loop_${Date.now()}`;
    const manager1 = getStudentStateManager(testUid, 'Basic');
    const manager2 = getStudentStateManager(testUid, 'Basic');
    assert(manager1 === manager2, 'getStudentStateManager returns singleton instance');

    let notifiedState: any = null;
    const unsubscribe = manager1.subscribe((state) => {
      notifiedState = state;
    });

    // Emit event through global event bus as would occur during exercises/quizzes
    eventBus.emit('EXERCISE_ANSWERED', testUid, {
      subject: 'math',
      topic: 'basic_algebra',
      conceptId: 'basic_algebra',
      isCorrect: true,
      responseTimeMs: 3500,
      difficulty: 'easy',
    });

    assert(notifiedState !== null, 'Subscriber was notified of state update from eventBus');
    assert(
      notifiedState?.conceptMastery['basic_algebra']?.attempts === 1 &&
      notifiedState?.conceptMastery['basic_algebra']?.correct === 1,
      'EventBus emission successfully updated conceptMastery in StudentStateManager'
    );

    // Test learning strain progression via consecutive errors and high latency
    eventBus.emit('EXERCISE_ANSWERED', testUid, {
      subject: 'math',
      topic: 'basic_algebra',
      conceptId: 'basic_algebra',
      isCorrect: false,
      responseTimeMs: 18000,
      difficulty: 'medium',
      mistakeType: 'sign_error',
    });
    eventBus.emit('EXERCISE_ANSWERED', testUid, {
      subject: 'math',
      topic: 'basic_algebra',
      conceptId: 'basic_algebra',
      isCorrect: false,
      responseTimeMs: 22000,
      difficulty: 'medium',
      mistakeType: 'sign_error',
    });

    assert(
      notifiedState.learningStrain.possibleStruggle >= 0.5,
      'Consecutive errors and high latency increase learning strain'
    );
    assert(
      notifiedState.learningStrain.signals.includes('repeated_errors') &&
      notifiedState.learningStrain.signals.includes('high_response_latency'),
      'Strain signals detect repeated_errors and high_response_latency'
    );

    unsubscribe();
    manager1.destroy();
  }

  // 9. AI Persona Generation & Active Intervention Directives
  console.log('\n[9] AI Persona Generation & Active Intervention Directives');
  {
    const mockProfile = {
      level: 'Basic',
      role: 'Student',
      field: 'Computer Science',
      accessibilityMode: 'Visual',
      studentState: {
        activePedagogy: 'worked_example' as const,
        learningStrain: {
          possibleStruggle: 0.8,
          confidence: 0.9,
          signals: ['repeated_errors', 'high_response_latency'],
        },
        activeInterventions: {
          dynamic_memory: {
            conceptId: 'dynamic_memory',
            strategy: 'worked_example',
            action: 'review_prerequisite',
            reason: 'Weak foundation in pointers',
            recommendedAction: 'review_prerequisite',
          },
        },
      },
    };

    const persona = buildPersona(mockProfile as any);
    assert(persona.includes('ACTIVE INTERVENTION DIRECTIVE:'), 'Persona includes ACTIVE INTERVENTION DIRECTIVE');
    assert(persona.includes('Strategy: worked_example'), 'Persona specifies worked_example strategy');
    assert(persona.includes('Target Concept: dynamic_memory'), 'Persona specifies target concept');
    assert(persona.includes('INSTRUCTION FOR LEARNING STRAIN:'), 'Persona includes high learning strain instructions');
    assert(persona.includes('USER IS BLIND'), 'Preserves accessibility instructions for Visual mode');
  }

  // 10. Deterministic AI Router with Student State Strain
  console.log('\n[10] Deterministic AI Router with Student State Strain');
  {
    // Fast route for normal short queries without strain
    const r1 = classifyRequest('What is a loop?', []);
    assert(r1 === 'fast', 'Short concept question routes to fast model');

    // Code block routes to reasoning
    const r2 = classifyRequest('How to fix this? ```python\nx = 1\n```', []);
    assert(r2 === 'reasoning', 'Code block routes to reasoning model');

    // High learning strain forces reasoning model even for short queries
    const r3 = classifyRequest('What is a loop?', [], {
      activePedagogy: 'scaffolded',
      learningStrain: { possibleStruggle: 0.8 },
    });
    assert(r3 === 'reasoning', 'High learning strain (>=0.7) deterministically routes to reasoning model');

    // Active worked_example pedagogy forces reasoning model
    const r4 = classifyRequest('Help with dynamic memory', [], {
      activePedagogy: 'worked_example',
      learningStrain: { possibleStruggle: 0.3 },
    });
    assert(r4 === 'reasoning', 'worked_example pedagogy deterministically routes to reasoning model');

    // Image attachment always routes to vision
    const r5 = classifyRequest('Help me', [{ type: 'image/png' }]);
    assert(r5 === 'vision', 'Image attachment routes to vision model');
  }

  // 11. Concept Detection from Natural Language
  console.log('\n[11] Concept Detection from Natural Language');
  {
    const c1 = detectConceptFromText('I am confused about pointers and addresses');
    assert(c1?.id === 'pointers', 'Detects pointers concept from English text');

    const c2 = detectConceptFromText('عايز أفهم الجبر والمعادلات الرياضية');
    assert(c2?.id === 'basic_algebra', 'Detects basic_algebra concept from Arabic text');

    const c3 = detectConceptFromText('What is the capital of France?');
    assert(c3 === null, 'Returns null for unrelated queries');
  }

  // 12. Spatial Memory Engine & Multi-User Isolation
  console.log('\n[12] Spatial Memory Engine & Multi-User Isolation');
  {
    // Extraction from English vision description
    const enText = 'In front of you on the wooden table, there is a black TV remote on the right side, and a cup on the desk.';
    const extractedEn = extractSpatialObjectsFromVision(enText, 'user_alice', 'en');
    assert(extractedEn.length >= 2, 'Extracts multiple spatial objects from English vision text');
    const remoteEn = extractedEn.find((e) => e.category === 'remote');
    assert(
      !!remoteEn && remoteEn.surface?.toLowerCase() === 'table' && remoteEn.relativePosition?.direction === 'right',
      'English extraction captures category, surface, and relative direction'
    );

    // Extraction from Arabic vision description
    const arText = 'أمامي على الترابيزة ريموت التلفزيون ناحية اليمين وفي الصالة مفاتيح على المكتب.';
    const extractedAr = extractSpatialObjectsFromVision(arText, 'user_alice', 'ar');
    assert(extractedAr.length >= 1, 'Extracts spatial objects from Arabic vision text');
    const remoteAr = extractedAr.find((e) => e.category === 'remote');
    assert(!!remoteAr && remoteAr.category === 'remote', 'Arabic extraction accurately resolves category for remote');

    // Extraction from French vision description
    const frText = 'Sur la table se trouve une télécommande sur la droite et des clés.';
    const extractedFr = extractSpatialObjectsFromVision(frText, 'user_alice', 'fr');
    assert(extractedFr.length >= 1, 'Extracts spatial objects from French vision text');
    const remoteFr = extractedFr.find((e) => e.category === 'remote');
    assert(!!remoteFr && remoteFr.category === 'remote', 'French extraction accurately resolves category for remote');

    // Multi-User Isolation: User A objects cannot be accessed by User B
    const userA = 'student_isolated_alpha';
    const userB = 'student_isolated_beta';

    const objA: any = {
      id: 'obj_alpha_1',
      uid: userA,
      category: 'keys',
      objectName: 'House Keys',
      surface: 'coffee table',
      room: 'living room',
      relativePosition: { direction: 'left' },
      lastSeenTimestamp: Date.now(),
      lastSeenIso: new Date().toISOString(),
      confidence: 0.95,
    };
    await saveSpatialObject(userA, objA);

    const memoryA = getSpatialObjects(userA);
    const memoryB = getSpatialObjects(userB);

    assert(memoryA.some((m) => m.category === 'keys'), "User A has access to User A's stored spatial object");
    assert(!memoryB.some((m) => m.category === 'keys'), "User B cannot see or access User A's spatial objects (Strict Multi-User Isolation)");

    // Location history transition
    const movedObjA: any = {
      ...objA,
      surface: 'kitchen counter',
      room: 'kitchen',
      lastSeenTimestamp: Date.now() + 1000,
    };
    await saveSpatialObject(userA, movedObjA);
    const updatedA = getSpatialObjects(userA).find((m) => m.category === 'keys');
    assert(updatedA?.surface === 'kitchen counter', 'Object surface updated to new location');
    assert(Array.isArray(updatedA?.history) && updatedA.history.length === 1, 'Location history records previous surface on move');
    assert(updatedA?.history?.[0]?.surface === 'coffee table', 'History contains coffee table as previous location');

    // Epistemic honesty in querySpatialMemory
    const freshQuery = querySpatialMemory(userA, 'Where are my keys?', 'en');
    assert(freshQuery.found === true && freshQuery.message.includes('kitchen counter'), 'Spatial query successfully finds remembered object');
    assert(!freshQuery.message.includes('Note: Since some time has passed'), 'Recent observation does not include stale time disclaimer');

    // Stale object query (> 20 minutes ago) includes epistemic disclaimer
    const staleObjA: any = {
      ...objA,
      category: 'remote',
      objectName: 'TV Remote',
      surface: 'sofa',
      lastSeenTimestamp: Date.now() - 30 * 60 * 1000, // 30 mins ago
    };
    await saveSpatialObject(userA, staleObjA);
    const staleQueryEn = querySpatialMemory(userA, 'Where is the remote?', 'en');
    assert(
      staleQueryEn.found === true && staleQueryEn.message.includes('Note: Since some time has passed'),
      'Epistemic honesty: Stale observation (> 20 min) includes time disclaimer in English'
    );

    const staleQueryAr = querySpatialMemory(userA, 'فين ريموت التلفزيون؟', 'ar');
    assert(
      staleQueryAr.found === true && staleQueryAr.message.includes('ملاحظة: نظراً لمرور بعض الوقت'),
      'Epistemic honesty: Stale observation includes time disclaimer in Arabic'
    );

    const staleQueryFr = querySpatialMemory(userA, 'Où est la télécommande ?', 'fr');
    assert(
      staleQueryFr.found === true && staleQueryFr.message.includes("Remarque : Du temps s'étant écoulé"),
      'Epistemic honesty: Stale observation includes time disclaimer in French'
    );
  }

  // 13. French First-Class Language Integration & AI Prompts
  console.log('\n[13] French First-Class Language Integration & AI Prompts');
  {
    // Translations test
    const frTitle = localize('French', 'spatial_memory');
    assert(frTitle === 'Mémoire spatiale', 'localize resolves French translation for spatial_memory');

    const frWhere = localize('French', 'where_is_my_stuff');
    assert(frWhere === 'Où sont mes affaires ?', 'localize resolves French translation for where_is_my_stuff');

    // Also supports 'fr' code
    const frShort = localize('fr', 'spatial_memory');
    assert(frShort === 'Mémoire spatiale', 'localize resolves "fr" language code');

    // AI persona building for French
    const frenchProfile = {
      level: 'Intermediate',
      role: 'Student',
      field: 'Computer Science',
      language: 'French',
      accessibilityMode: 'None',
      spatialMemories: [
        {
          category: 'remote',
          objectName: 'Télécommande',
          surface: 'table du salon',
          room: 'salon',
          lastSeenIso: new Date().toISOString(),
        },
      ],
    };

    const frenchPersona = buildPersona(frenchProfile as any);
    assert(
      frenchPersona.includes('French in → reply in natural, fluent, idiomatic French'),
      'Persona includes French language mirroring instruction'
    );
    assert(frenchPersona.includes('FRANCE TRAVEL & SPOKEN FRENCH ASSISTANCE'), 'Persona includes France Travel & Spoken French assistance section');
    assert(frenchPersona.includes('Bonjour Madame'), 'Persona includes essential French politeness guidance');
    assert(frenchPersona.includes('phonetic pronunciation guide'), 'Persona includes phonetic pronunciation directives for traveler');
    assert(frenchPersona.includes('COGNIFY SPATIAL MEMORY'), 'Persona includes Spatial Memory context block');
    assert(frenchPersona.includes('Télécommande: on table du salon'), 'Persona formats remembered physical objects in spatial block');

    // Access control verification for France Travel Voice
    const normalUser = { uid: 'u1', accountPath: 'Normal' as const };
    const a11yUser = { uid: 'u2', accountPath: 'Special Needs' as const, accessibilityMode: 'Visual' };
    assert(canAccessView(normalUser as any, 'france', false) === true, 'Normal user can access France Travel Voice');
    assert(canAccessView(a11yUser as any, 'france', false) === true, 'Accessibility user can access France Travel Voice');
  }

  // 14. Multi-Language & Disability System Localization (All 11 Languages)
  console.log('\n[14] Multi-Language & Disability System Localization (All 11 Languages)');
  {
    // French disability modes and actions
    assert(localize('French', '⚡ Motor & Euphonia') === '⚡ Moteur & Euphonia', 'French: ⚡ Motor & Euphonia');
    assert(localize('French', '👁️ Visual Companion') === '👁️ Compagnon Visuel', 'French: 👁️ Visual Companion');
    assert(localize('French', '🤖 AI Sign Studio') === '🤖 Studio LSF par IA', 'French: 🤖 AI Sign Studio');
    assert(localize('French', '🤝 Two-Way Bridge') === '🤝 Passerelle de Communication', 'French: 🤝 Two-Way Bridge');
    assert(localize('French', '💬 Text Chat') === '💬 Discussion Textuelle', 'French: 💬 Text Chat');

    // Multi-language coverage for other supported languages
    assert(localize('Spanish', '⚡ Motor & Euphonia') === '⚡ Motor y Euphonia', 'Spanish: ⚡ Motor & Euphonia');
    assert(localize('German', '⚡ Motor & Euphonia') === '⚡ Motorik & Euphonia', 'German: ⚡ Motor & Euphonia');
    assert(localize('Italian', '⚡ Motor & Euphonia') === '⚡ Motorio ed Euphonia', 'Italian: ⚡ Motor & Euphonia');
    assert(localize('Russian', '⚡ Motor & Euphonia') === '⚡ Моторный и Euphonia', 'Russian: ⚡ Motor & Euphonia');
    assert(localize('Chinese', '⚡ Motor & Euphonia') === '⚡ 运动与 Euphonia', 'Chinese: ⚡ Motor & Euphonia');
    assert(localize('Japanese', '⚡ Motor & Euphonia') === '⚡ モーター＆Euphonia', 'Japanese: ⚡ Motor & Euphonia');

    // Language code alias resolution (fr, es, de, it, pt, ru, zh, ja)
    assert(localize('es', '⚡ Motor & Euphonia') === '⚡ Motor y Euphonia', 'Alias "es" resolves to Spanish');
    assert(localize('de', '⚡ Motor & Euphonia') === '⚡ Motorik & Euphonia', 'Alias "de" resolves to German');
    assert(localize('zh', '⚡ Motor & Euphonia') === '⚡ 运动与 Euphonia', 'Alias "zh" resolves to Chinese');

    // Arabic & Egyptian Ammiya RTL fallback preservation
    assert(localize('Arabic', 'Hello', 'مرحبا') === 'مرحبا', 'Arabic returns Arabic fallback text');
    assert(localize('Egyptian Ammiya', 'Hello', 'أهلا') === 'أهلا', 'Egyptian Ammiya returns Arabic fallback text');

    // AI persona incorporates configured user language
    const profileSpanish = { level: 'Advanced', language: 'Spanish', accessibilityMode: 'None' };
    const personaSpanish = buildPersona(profileSpanish as any);
    assert(personaSpanish.includes('Configured Language: Spanish'), 'Persona includes Configured Language for Spanish');

    const profileFrench = { level: 'Advanced', language: 'French', accessibilityMode: 'None' };
    const personaFrench = buildPersona(profileFrench as any);
    assert(personaFrench.includes('Configured Language: French'), 'Persona includes Configured Language for French');
  }

  // 15. Super Admin Database Hub & Security Inspect Tracker
  console.log('\n[15] Super Admin Database Hub & Security Inspect Tracker');
  {
    // Database Health check
    const health = await getDatabaseHealth();
    assert(health.region === 'Frankfurt (europe-west1)', 'Database health returns Frankfurt europe-west1 region');
    assert(health.latencyMs >= 0, 'Database health returns non-negative latency in ms');
    assert(health.status === 'healthy' || health.status === 'degraded', 'Database health returns valid status');

    // Collection stats estimation
    const stats = getCollectionStats(100);
    assert(stats.usersCount === 100, 'Collection stats tracks 100 users correctly');
    assert(stats.estimatedChatThreads > 100, 'Estimated chat threads scales proportionally with users');
    assert(stats.estimatedStorageKb > 0, 'Estimated storage footprint calculated');

    // Full system backup generation
    const mockUsers: any[] = [{ uid: 'test-1', email: 'test@cognify.app', points: 150 }];
    const backup = generateFullSystemBackupJson(mockUsers as any, []);
    assert(backup.filename.includes('backup-') && backup.filename.endsWith('.json'), 'Backup generates timestamped filename');
    assert((backup.jsonString || '').includes('Cognify'), 'Backup contains system metadata header');
    assert((backup.jsonString || '').includes('test@cognify.app'), 'Backup contains user records');

    // Stale session & cache cleaner
    const cleanup = await cleanStaleSessionsAndCache();
    assert(typeof cleanup.cleanedKeys === 'number' && cleanup.cleanedKeys >= 0, 'Clean stale sessions runs safely');

    // Security tracker IP resolution
    const ip = await resolveClientIp();
    assert(typeof ip === 'string' && ip.length > 0, 'resolveClientIp returns valid non-empty string');

    // Security event logger
    const testRecord = await logSecurityEvent(
      { uid: 'admin-1', email: 'admin@cognify.app', isAdmin: true },
      'devtools_inspect_shortcut',
      'Test F12 inspect event'
    );
    assert(testRecord !== null && testRecord.role === 'Admin', 'logSecurityEvent properly logs admin security record');
    assert(testRecord?.eventType === 'devtools_inspect_shortcut', 'logSecurityEvent correctly records event type');

    // Markdown audit report
    const report = generateDatabaseAuditReport(mockUsers as any, [testRecord]);
    assert(report.includes('Frankfurt (europe-west1)'), 'Audit report contains correct database region');
    assert(report.includes('Active User Accounts: 1') || report.includes('Registered Users: 1'), 'Audit report contains accurate user counts');
  }

  console.log(`\n========================================`);
  console.log(`Test Results: ${totalPassed} Passed, ${totalFailed} Failed`);
  console.log(`========================================\n`);

  if (totalFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});