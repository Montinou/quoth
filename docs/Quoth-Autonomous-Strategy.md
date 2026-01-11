# **Quoth Autonomous Protocol: "The Silent Guardian"**

## **Arquitectura de Gobernanza 100% Agentica con Notificación Asíncrona**

### **1\. Executive Summary**

El objetivo es eliminar al humano del bucle de aprobación ("Human-in-the-loop") y moverlo al bucle de observación ("Human-on-the-loop").

**El Nuevo Flujo:**

1. **Detección:** Claude (Architect Persona) detecta inconsistencias y llama a quoth\_propose\_update.  
2. **Juicio:** Un proceso en segundo plano despierta al **Gatekeeper Agent** (IA Juez).  
3. **Veredicto:** El Gatekeeper analiza el diff. Si es coherente, lo aprueba automáticamente.  
4. **Ejecución:** Quoth commitea directamente a main en GitHub.  
5. **Notificación:** Se dispara un email vía **Resend** a los Tech Leads con el resumen del cambio.

### **2\. Architecture Diagram**

graph TD  
    User\[Dev Coding\] \--\>|Ask| Architect\[Agent 1: Architect\]  
    Architect \--\>|1. Propose Update| DB\[(Supabase: Proposals)\]  
      
    DB \--\>|Trigger Webhook| Judge\[Agent 2: The Gatekeeper\]  
      
    Judge \--\>|2. Analyze Risk| Logic{Safe & Valid?}  
      
    Logic \-- YES \--\> Commit\[GitHub API: Commit\]  
    Logic \-- NO \--\> Reject\[Update Status: Rejected\]  
      
    Commit \--\>|3. Webhook| Sync\[Sync Service\]  
    Sync \--\>|Update Index| VectorDB\[(Supabase: Documents)\]  
      
    Commit \--\>|4. Notify| Email\[Resend API\]  
    Email \--\>|FYI| Human\[Tech Lead\]

### **3\. The Gatekeeper Agent (El Juez Automático)**

Este agente no interactúa con el usuario. Es una función serverless que recibe dos textos y devuelve un JSON.

**Endpoint:** POST /api/governance/adjudicate

#### **3.1 System Prompt (Adversarial)**

\<system\_prompt\>  
    \<role\>  
        You are the \*\*Quoth High Council Gatekeeper\*\*, an automated auditor responsible for the integrity of the project's documentation.  
    \</role\>

    \<task\>  
        Review a documentation change proposed by another AI agent. Your job is to APPROVE valid improvements and REJECT hallucinations or destructive changes.  
    \</task\>

    \<inputs\>  
        1\. Original Content  
        2\. Proposed Content  
        3\. Agent's Reasoning  
        4\. Evidence Snippet (Code)  
    \</inputs\>

    \<evaluation\_criteria\>  
        1\. \*\*Truthfulness:\*\* Does the \`evidence\_snippet\` actually contradict the \`original\_content\`? If the code snippet doesn't match the proposal, REJECT.  
        2\. \*\*Safety:\*\* Is the agent trying to delete critical sections (like Auth keys explanation) without replacement? If yes, REJECT.  
        3\. \*\*Style:\*\* Does it follow Markdown best practices?  
    \</evaluation\_criteria\>

    \<decision\_protocol\>  
        \- You have FULL AUTHORITY to approve changes.  
        \- You must output a JSON object.  
    \</decision\_protocol\>

    \<output\_schema\>  
        {  
            "verdict": "APPROVED" | "REJECTED",  
            "confidence\_score": 0-100,  
            "risk\_analysis": "String explaining potential risks",  
            "modification\_summary": "One sentence summary for the email subject"  
        }  
    \</output\_schema\>  
\</system\_prompt\>

### **4\. Implementation Logic (Next.js)**

#### **4.1 La API de Adjudicación (/api/governance/adjudicate)**

// pages/api/governance/adjudicate.ts  
import { generateObject } from 'ai'; // Vercel AI SDK  
import { google } from '@ai-sdk/google'; // Gemini Provider  
import { Resend } from 'resend';

const resend \= new Resend(process.env.RESEND\_API\_KEY);

export default async function handler(req, res) {  
  const { proposalId } \= req.body;  
    
  // 1\. Fetch Proposal  
  const proposal \= await getProposalFromSupabase(proposalId);  
    
  // 2\. Invoke The Gatekeeper (AI Judge)  
  const { object: judgment } \= await generateObject({  
    model: google('gemini-1.5-pro'), // Modelo más inteligente para juzgar  
    system: GATEKEEPER\_SYSTEM\_PROMPT,  
    prompt: \`  
      Original: ${proposal.original\_content}  
      Proposed: ${proposal.proposed\_content}  
      Reasoning: ${proposal.reasoning}  
      Evidence: ${proposal.evidence\_snippet}  
    \`,  
    schema: z.object({  
      verdict: z.enum(\['APPROVED', 'REJECTED'\]),  
      risk\_analysis: z.string(),  
      modification\_summary: z.string()  
    })  
  });

  // 3\. Execute Decision  
  if (judgment.verdict \=== 'APPROVED') {  
    // A. Commit to GitHub  
    const commitSha \= await commitToGitHub({  
      path: proposal.file\_path,  
      content: proposal.proposed\_content,  
      message: \`\[Quoth Auto-Fix\] ${judgment.modification\_summary}\`  
    });

    // B. Update Proposal Status  
    await updateProposalStatus(proposalId, 'applied', judgment);

    // C. Notify via Resend  
    await resend.emails.send({  
      from: 'Quoth Guardian \<auditor@quoth.ai\>',  
      to: \['tech-leads@exolar.com'\],  
      subject: \`\[Quoth\] Auto-Updated: ${proposal.file\_path}\`,  
      react: EmailTemplate({   
        file: proposal.file\_path,  
        reason: proposal.reasoning,  
        risk: judgment.risk\_analysis,  
        diffUrl: \`https://github.com/org/repo/commit/${commitSha}\`  
      })  
    });

  } else {  
    // Reject  
    await updateProposalStatus(proposalId, 'rejected', judgment);  
  }

  return res.json({ success: true, judgment });  
}

#### **4.2 El Template de Email (React Email)**

El email no pide permiso, informa acción.

// components/emails/AutoUpdateEmail.tsx  
import { Html, Head, Preview, Section, Text, Link } from '@react-email/components';

export const AutoUpdateEmail \= ({ file, reason, risk, diffUrl }) \=\> (  
  \<Html\>  
    \<Head /\>  
    \<Preview\>Quoth has updated {file}\</Preview\>  
    \<Section style={{ fontFamily: 'sans-serif', padding: '20px' }}\>  
      \<Text style={{ fontSize: '20px', fontWeight: 'bold', color: '\#8B5CF6' }}\>  
        Quoth Autonomous Action  
      \</Text\>  
      \<Text\>  
        The Gatekeeper agent has approved and applied a change to:  
        \<br /\>  
        \<strong\>{file}\</strong\>  
      \</Text\>  
        
      \<Section style={{ background: '\#f4f4f5', padding: '15px', borderRadius: '5px' }}\>  
        \<Text style={{ margin: 0, fontWeight: 'bold' }}\>Why?\</Text\>  
        \<Text style={{ margin: 0 }}\>{reason}\</Text\>  
        \<br/\>  
        \<Text style={{ margin: 0, fontWeight: 'bold' }}\>Risk Analysis:\</Text\>  
        \<Text style={{ margin: 0 }}\>{risk}\</Text\>  
      \</Section\>

      \<Section style={{ marginTop: '20px' }}\>  
        \<Link href={diffUrl} style={{ color: '\#8B5CF6', textDecoration: 'underline' }}\>  
          View Diff on GitHub  
        \</Link\>  
      \</Section\>  
        
      \<Text style={{ fontSize: '12px', color: '\#666' }}\>  
        This action was performed automatically. If incorrect, revert the commit in GitHub.  
      \</Text\>  
    \</Section\>  
  \</Html\>  
);

### **5\. Safeguards (Los Frenos de Emergencia)**

Aunque sea "completamente agentico", necesitamos límites en el código para evitar desastres.

1. **Rate Limiting:** El Juez solo puede aprobar 5 cambios por hora. Si se supera, los siguientes quedan en pending para revisión humana (evita loops infinitos de edición).  
2. **Protected Files:** Lista negra de archivos que la IA **nunca** puede tocar automáticamente (ej: .env.example, package.json, security-policy.md).  
   * *Lógica:* Si file\_path está en PROTECTED\_LIST, el Juez fuerza verdict: "REJECTED".

### **6\. Configuración de Despliegue**

1. **Instalar Resend:** npm install resend  
2. **Variables de Entorno:**  
   * RESEND\_API\_KEY: Para enviar los correos.  
   * EMAIL\_RECIPIENTS: Lista separada por comas de quién recibe los avisos.  
3. **Cron Job (Opcional):** Si prefieres procesar en lotes en lugar de tiempo real, configura un Cron en Vercel para llamar a /api/governance/process-queue cada hora.

### **Resumen del Flujo**

1. **Agente Arquitecto:** "Hey, encontré un error en la doc de Auth." \-\> Propose  
2. **Agente Juez (Server):** "Analizando... El cambio es válido y seguro." \-\> Approve & Commit  
3. **Resend:** *Ping\!* Email al Tech Lead: "Quoth actualizó auth.md. Razón: Actualización de librería."  
4. **GitHub:** El historial refleja el cambio.  
5. **Supabase:** Se sincroniza automáticamente.

**Resultado:** Documentación viva, autocurativa y con cero fricción humana, pero totalmente observable.