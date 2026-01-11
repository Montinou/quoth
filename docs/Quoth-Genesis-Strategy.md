# **Quoth Genesis Protocol: "The Digital Archaeologist"**

## **Estrategia de Auto-Documentación Inicial para Proyectos Legacy**

### **1\. El Concepto (The Pitch)**

**El Problema:** La mayor fricción para adoptar Quoth es la configuración inicial. Nadie quiere escribir los primeros 10 archivos Markdown de "Arquitectura" y "Patrones" manualmente.

**La Solución:** quoth\_genesis. Una herramienta MCP que actúa como un **Arqueólogo Forense**. Entra en un repositorio desconocido, lee los "huesos" (configs, estructura de carpetas) y deduce las "leyes" no escritas, generando la documentación inicial automáticamente.

### **2\. Definición de la Tool (MCP)**

Esta herramienta está diseñada para ser invocada por **Claude Code** (CLI) o **Cursor** al inicio de la sesión.

// lib/mcp/tools/genesis.ts

export const quoth\_genesis \= {  
  name: "quoth\_genesis",  
  description: "Analyzes an undocumented repository to extract architectural patterns, tech stack, and implicit rules. Generates the initial 'Quoth Laws' documentation.",  
  inputSchema: {  
    type: "object",  
    properties: {  
      root\_path: {   
        type: "string",   
        description: "Path to start analysis (usually '.' or './src')"   
      },  
      depth: {   
        type: "string",   
        enum: \["shallow", "deep"\],   
        description: "Shallow: Stack & Folder Structure. Deep: Code Patterns (e.g. Auth flow)."   
      }  
    },  
    required: \["root\_path"\]  
  }  
};

### **3\. La Estrategia de Ejecución (Cómo no quebrar la banca)**

No podemos pasarle todo el codebase a la IA (context window & cost). Usamos una estrategia de **Muestreo Estructural**.

#### **Fase 1: El Escaneo de Esqueleto (Shallow Scan)**

La tool lee *solo* archivos de configuración clave.

* **Archivos Objetivo:** package.json, tsconfig.json, docker-compose.yml, next.config.js, .env.example.  
* **Output Esperado:** Stack Tecnológico (Next.js, Tailwind, Supabase, Vitest).

#### **Fase 2: El Muestreo de Tejido (Deep Scan)**

La tool lista la estructura de carpetas (tree \-L 2 src/) e identifica patrones repetitivos.

* **Heurística:** Si hay una carpeta /services con 20 archivos, lee **solo 2 archivos al azar**.  
* **Deducción:** "Veo que los servicios exportan clases estáticas y usan inyección de dependencias." \-\> **Regla Generada.**

#### **Fase 3: La Generación (Genesis)**

La tool crea archivos Markdown en memoria y propone escribirlos en .quoth/.

### **4\. El Prompt del Sistema ("The Archaeologist Persona")**

Este prompt se inyecta cuando se llama a quoth\_genesis.

\<system\_prompt\>  
    \<role\>  
        You are the \*\*Quoth Archaeologist\*\*. Your mission is to enter an unknown repository, deduce its unwritten laws, and formalize them into documentation.  
    \</role\>

    \<prime\_directive\>  
        Do NOT describe \*what\* the code does (business logic).  
        Describe \*how\* the code is structured (architectural patterns).  
    \</prime\_directive\>

    \<extraction\_rules\>  
        1\. \*\*Tech Stack:\*\* Identify core frameworks from \`package.json\`.  
        2\. \*\*Folder Architecture:\*\* Explain the purpose of top-level folders (e.g., "\`/actions\` contains Server Actions").  
        3\. \*\*Testing Strategy:\*\* Deduce if they use Jest/Vitest and where tests are located.  
        4\. \*\*Naming Conventions:\*\* (e.g., "All components are PascalCase").  
    \</extraction\_rules\>

    \<output\_format\>  
        Generate minimal Markdown files. Do NOT be verbose. Use bullet points.  
        Required Files:  
        \- \`architecture/tech-stack.md\`  
        \- \`architecture/folder-structure.md\`  
        \- \`patterns/testing-strategy.md\` (if tests exist)  
    \</output\_format\>  
\</system\_prompt\>

### **5\. Flujo de Usuario (The "Magic Moment")**

Imagina esto en la terminal de un desarrollador nuevo usando **Claude Code**:

\> claude  
Welcome to Claude Code.

user\> @quoth init \--auto

Claude\> Invoking \`quoth\_genesis\`...  
⚙️ Scanning project skeleton...  
  \-\> Detected Next.js 14 (App Router)  
  \-\> Detected Supabase  
  \-\> Detected Tailwind CSS

🔍 Analyzing deep patterns...  
  \-\> Sampling \`src/components/ui\`... (Found Shadcn UI pattern)  
  \-\> Sampling \`src/lib/actions\`... (Found Server Actions pattern)

📝 Genesis Complete. I have generated the following initial laws:  
  1\. .quoth/architecture/stack.md  
  2\. .quoth/architecture/structure.md  
  3\. .quoth/patterns/server-actions.md

user\> cat .quoth/patterns/server-actions.md

\# Pattern: Server Actions  
\- All database mutations must happen in \`src/actions\`.  
\- Must use \`zod\` for input validation.  
\- Must return \`{ success: boolean, error?: string }\`.

### **6\. Implementación Técnica (Node.js Script)**

Este es el script que la tool quoth\_genesis ejecuta internamente.

// lib/genesis/scanner.ts  
import fs from 'fs/promises';  
import path from 'path';

export async function scanRepository(root: string) {  
  // 1\. Read Configs  
  const pkgJson \= await safeReadJson(path.join(root, 'package.json'));  
  const tsConfig \= await safeReadJson(path.join(root, 'tsconfig.json'));  
    
  // 2\. Map Directory Structure (Max Depth 2\)  
  const tree \= await getDirectoryTree(root, 2);  
    
  // 3\. Smart Sampling  
  const samples \= \[\];  
  if (tree.includes('src/components')) {  
    samples.push(await readSampleFile(path.join(root, 'src/components'), 2));  
  }  
    
  // 4\. Construct Context Payload  
  return {  
    dependencies: pkgJson?.dependencies || {},  
    structure: tree,  
    code\_samples: samples  
  };  
}

// Helper to read 1-2 random files from a dir  
async function readSampleFile(dir: string, count: number) {  
  const files \= await fs.readdir(dir);  
  const sampleFiles \= files.filter(f \=\> f.endsWith('.ts') || f.endsWith('.tsx')).slice(0, count);  
  // Read content...  
}

### **7\. Por qué esto valida el producto**

Transforma el valor de Quoth:

* **Antes:** "Una herramienta que me obliga a trabajar más (escribir docs)."  
* **Ahora (con Genesis):** "Una herramienta que **hace el trabajo sucio por mí** y luego me protege."

Consejo de Implementación:  
Empieza muy simple. Haz que quoth\_genesis solo genere architecture/tech-stack.md y architecture/folder-structure.md. Si intentas documentar lógica de negocio compleja al principio, la IA alucinará. Céntrate en lo estructural (Frameworks, Carpetas, Convenciones de Nombres).