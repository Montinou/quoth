"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Sparkles,
  Layers,
  Bot,
  FileText,
  Rocket,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Logo } from "@/components/quoth/Logo";
import { useToast } from "@/contexts/ToastContext";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface CreatedProject {
  id: string;
  name: string;
  slug: string;
}

interface CreatedAgent {
  id: string;
  name: string;
  displayName: string;
}

interface OnboardingFlowProps {
  initialStep: number;
  initialData: Record<string, string>;
}

interface StepComponentProps {
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  goBack?: () => void;
  currentStep: number;
  totalSteps: number;
  loading: boolean;
  savedData: Record<string, string>;
  createdProjects?: CreatedProject[];
  setCreatedProjects?: React.Dispatch<React.SetStateAction<CreatedProject[]>>;
  createdAgents?: CreatedAgent[];
  setCreatedAgents?: React.Dispatch<React.SetStateAction<CreatedAgent[]>>;
}

// ── Shared wrappers (adapted from onboarding1) ──────────────────────────────

function OnboardingStepHeader({
  title,
  description,
  stepIndex,
  totalSteps,
  goBack,
}: {
  title: string;
  description?: string;
  stepIndex: number;
  totalSteps: number;
  goBack?: () => void;
}) {
  return (
    <div className="relative">
      {goBack && stepIndex > 0 && (
        <Button
          variant="ghost"
          size="icon"
          onClick={goBack}
          className="absolute top-1/2 right-full -translate-x-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
        >
          <ChevronLeft className="size-4" />
        </Button>
      )}
      <div>
        <p className="text-sm font-medium text-gray-500">
          {stepIndex + 1}/{totalSteps}
        </p>
        <h3
          className="text-2xl font-semibold tracking-tight text-white md:whitespace-nowrap"
          style={{ fontFamily: "var(--font-cormorant), serif" }}
        >
          {title}
        </h3>
        {description && (
          <p className="mt-2 text-sm text-gray-400">{description}</p>
        )}
      </div>
    </div>
  );
}

function OnboardingStepLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full max-w-5xl mx-auto flex-col-reverse gap-0 rounded-3xl border border-zinc-700/50 bg-gradient-to-br from-zinc-900/90 via-zinc-900/70 to-zinc-950/90 backdrop-blur-2xl shadow-2xl shadow-violet-900/10 md:min-h-[70dvh] md:flex-row overflow-hidden">
      {children}
    </div>
  );
}

function LeftPanel({
  title,
  description,
  currentStep,
  totalSteps,
  goBack,
  children,
}: {
  title: string;
  description?: string;
  currentStep: number;
  totalSteps: number;
  goBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 justify-center p-8 sm:p-10 md:p-16 lg:p-20">
      <div className="flex h-full w-full max-w-md shrink-0 flex-col gap-6">
        <OnboardingStepHeader
          title={title}
          description={description}
          stepIndex={currentStep}
          totalSteps={totalSteps}
          goBack={goBack}
        />
        {children}
      </div>
    </div>
  );
}

function RightPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "hidden flex-1 overflow-hidden lg:flex items-center justify-center border-l border-zinc-700/30 bg-gradient-to-br from-zinc-800/20 to-violet-950/10",
        className,
      )}
    >
      {children}
    </div>
  );
}

function FormField({
  label,
  placeholder,
  name,
  type = "text",
  value,
  onChange,
  disabled,
}: {
  label: string;
  placeholder: string;
  name: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name} className="text-gray-300">
        {label}
      </Label>
      <Input
        type={type}
        id={name}
        placeholder={placeholder}
        name={name}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="w-full bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-violet-500 focus:ring-violet-500/20"
      />
    </div>
  );
}

// ── Geometric Pattern (right panel visual) ───────────────────────────────────

function GeometricPattern({ icon }: { icon?: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
      className="relative w-full h-full flex items-center justify-center"
    >
      {/* Radial gradient background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.08)_0%,transparent_70%)]" />

      {/* Geometric grid */}
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: `
          linear-gradient(rgba(124,58,237,0.5) 1px, transparent 1px),
          linear-gradient(90deg, rgba(124,58,237,0.5) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px',
      }} />

      {/* Diagonal lines */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="diag" width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="60" stroke="rgb(139,92,246)" strokeWidth="1"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#diag)" />
      </svg>

      {/* Floating geometric shapes */}
      <div className="relative z-10 flex flex-col items-center gap-8">
        {/* Central icon */}
        <motion.div
          animate={{ y: [-4, 4, -4] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="size-20 rounded-2xl bg-gradient-to-br from-violet-600/20 to-violet-800/10 border border-violet-500/20 flex items-center justify-center backdrop-blur-sm shadow-lg shadow-violet-900/20"
        >
          {icon ?? <Sparkles className="size-10 text-violet-400/80" />}
        </motion.div>

        {/* Decorative rings */}
        <div className="absolute size-40 rounded-full border border-violet-500/[0.06] -z-10" />
        <div className="absolute size-64 rounded-full border border-violet-500/[0.04] -z-10" />
        <div className="absolute size-96 rounded-full border border-violet-500/[0.02] -z-10" />

        {/* Corner accents */}
        <div className="absolute top-8 right-8 size-3 rounded-full bg-violet-500/20" />
        <div className="absolute bottom-12 left-12 size-2 rounded-full bg-violet-400/15" />
        <div className="absolute top-1/3 left-8 size-1.5 rounded-full bg-violet-300/10" />
      </div>
    </motion.div>
  );
}

// ── Slug helper ──────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── Step 0: Organization ─────────────────────────────────────────────────────

function StepOrganization({
  onSubmit,
  currentStep,
  totalSteps,
  loading,
}: StepComponentProps) {
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setOrgName(val);
    if (!slugManual) setOrgSlug(slugify(val));
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlugManual(true);
    setOrgSlug(slugify(e.target.value));
  };

  return (
    <OnboardingStepLayout>
      <LeftPanel
        title="Welcome to Quoth"
        description="Create your organization to get started."
        currentStep={currentStep}
        totalSteps={totalSteps}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ orgName, orgSlug });
          }}
          className="space-y-6 py-4"
        >
          <FormField
            label="Organization name"
            placeholder="Acme Labs"
            name="orgName"
            value={orgName}
            onChange={handleNameChange}
            disabled={loading}
          />
          <FormField
            label="Organization slug"
            placeholder="acme-labs"
            name="orgSlug"
            value={orgSlug}
            onChange={handleSlugChange}
            disabled={loading}
          />
          <Button
            type="submit"
            disabled={loading || !orgName.trim()}
            className="mt-4 w-full bg-violet-600 hover:bg-violet-700 text-white"
          >
            {loading ? "Creating..." : "Continue"}
          </Button>
        </form>
      </LeftPanel>
      <RightPanel>
        <GeometricPattern icon={<Layers className="size-8 text-violet-400/80" />} />
      </RightPanel>
    </OnboardingStepLayout>
  );
}

// ── Step 1: Project ──────────────────────────────────────────────────────────

function StepProject({
  onSubmit,
  goBack,
  currentStep,
  totalSteps,
  loading,
  createdProjects = [],
  setCreatedProjects,
}: StepComponentProps) {
  const [projectName, setProjectName] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [description, setDescription] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [adding, setAdding] = useState(false);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setProjectName(val);
    if (!slugManual) setProjectSlug(slugify(val));
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlugManual(true);
    setProjectSlug(slugify(e.target.value));
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      await onSubmit({
        action: "add",
        projectName,
        projectSlug,
        description,
      });
      setCreatedProjects?.((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name: projectName, slug: projectSlug },
      ]);
      setProjectName("");
      setProjectSlug("");
      setDescription("");
      setSlugManual(false);
    } finally {
      setAdding(false);
    }
  };

  const handleContinue = () => {
    onSubmit({ action: "continue" });
  };

  return (
    <OnboardingStepLayout>
      <LeftPanel
        title={createdProjects.length ? "Add projects" : "Create your first project"}
        description="Projects group documents, agents, and search indexes."
        currentStep={currentStep}
        totalSteps={totalSteps}
        goBack={goBack}
      >
        <div className="space-y-6 py-4">
          {/* Created projects list */}
          {createdProjects.length > 0 && (
            <div className="space-y-2">
              {createdProjects.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2"
                >
                  <Check className="size-3.5 text-violet-400 shrink-0" />
                  <span className="text-sm text-gray-200 truncate">{p.name}</span>
                  <span className="text-xs text-gray-500 truncate">/{p.slug}</span>
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAdd();
            }}
            className="space-y-4"
          >
            <FormField
              label="Project name"
              placeholder="My App"
              name="projectName"
              value={projectName}
              onChange={handleNameChange}
              disabled={loading || adding}
            />
            <FormField
              label="Project slug"
              placeholder="my-app"
              name="projectSlug"
              value={projectSlug}
              onChange={handleSlugChange}
              disabled={loading || adding}
            />
            <div className="space-y-2">
              <Label htmlFor="description" className="text-gray-300">
                Description (optional)
              </Label>
              <Textarea
                id="description"
                placeholder="A brief description of your project..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={loading || adding}
                className="w-full bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-violet-500"
                style={{ resize: "none" }}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                variant="outline"
                disabled={loading || adding || !projectName.trim()}
                className="flex-1 border-zinc-700 text-gray-300 hover:bg-zinc-800 hover:text-white"
              >
                <Plus className="mr-1 size-4" />
                {adding ? "Adding..." : createdProjects.length ? "Add Another Project" : "Add Project"}
              </Button>
              <Button
                type="button"
                onClick={handleContinue}
                disabled={loading || createdProjects.length === 0}
                className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
              >
                {loading ? "Saving..." : "Continue"}
              </Button>
            </div>
          </form>
        </div>
      </LeftPanel>
      <RightPanel>
        <GeometricPattern icon={<Layers className="size-8 text-violet-400/80" />} />
      </RightPanel>
    </OnboardingStepLayout>
  );
}

// ── Step 2: Agent ────────────────────────────────────────────────────────────

function StepAgent({
  onSubmit,
  goBack,
  currentStep,
  totalSteps,
  loading,
  createdProjects = [],
  createdAgents = [],
  setCreatedAgents,
}: StepComponentProps) {
  const [agentName, setAgentName] = useState("claude");
  const [displayName, setDisplayName] = useState("Claude");
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [role, setRole] = useState("orchestrator");
  const [selectedProjectId, setSelectedProjectId] = useState(
    createdProjects[0]?.id ?? ""
  );
  const [adding, setAdding] = useState(false);
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);

  const handleAdd = async () => {
    setAdding(true);
    try {
      await onSubmit({
        action: "add",
        agentName: slugify(agentName),
        displayName,
        model,
        role,
        projectId: selectedProjectId,
      });
      setCreatedAgents?.((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name: slugify(agentName), displayName },
      ]);
      setAgentName("");
      setDisplayName("");
      setModel("claude-sonnet-4-6");
      setRole("orchestrator");
    } finally {
      setAdding(false);
    }
  };

  const handleContinue = () => {
    onSubmit({ action: "continue" });
  };

  return (
    <OnboardingStepLayout>
      <LeftPanel
        title="Register your AI agents"
        description="Connect AI agents to your projects for documentation and search."
        currentStep={currentStep}
        totalSteps={totalSteps}
        goBack={goBack}
      >
        <div className="space-y-5 py-4">
          {/* Created agents list */}
          {createdAgents.length > 0 && (
            <div className="space-y-2">
              {createdAgents.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2"
                >
                  <Check className="size-3.5 text-violet-400 shrink-0" />
                  <span className="text-sm text-gray-200 truncate">{a.displayName}</span>
                  <span className="text-xs text-gray-500 truncate">({a.name})</span>
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAdd();
            }}
            className="space-y-4"
          >
            <FormField
              label="Agent name"
              placeholder="claude"
              name="agentName"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              disabled={loading || adding}
            />
            <FormField
              label="Display name"
              placeholder="Claude"
              name="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={loading || adding}
            />

            {createdProjects.length > 1 && (
              <div className="space-y-2">
                <Label className="text-gray-300">Assign to project</Label>
                <Select
                  value={selectedProjectId}
                  onValueChange={setSelectedProjectId}
                  disabled={loading || adding}
                >
                  <SelectTrigger className="w-full bg-zinc-800/50 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {createdProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-gray-300">Model</Label>
              <Select value={model} onValueChange={setModel} disabled={loading || adding}>
                <SelectTrigger className="w-full bg-zinc-800/50 border-zinc-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
                  <SelectItem value="claude-opus-4-6">Claude Opus 4.6</SelectItem>
                  <SelectItem value="claude-haiku-4-5">Claude Haiku 4.5</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-300">Role</Label>
              <Select value={role} onValueChange={setRole} disabled={loading || adding}>
                <SelectTrigger className="w-full bg-zinc-800/50 border-zinc-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="orchestrator">Orchestrator</SelectItem>
                  <SelectItem value="specialist">Specialist</SelectItem>
                  <SelectItem value="curator">Curator</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                variant="outline"
                disabled={loading || adding || !agentName.trim()}
                className="flex-1 border-zinc-700 text-gray-300 hover:bg-zinc-800 hover:text-white"
              >
                <Plus className="mr-1 size-4" />
                {adding ? "Adding..." : createdAgents.length ? "Add Another Agent" : "Add Agent"}
              </Button>
              <Button
                type="button"
                onClick={handleContinue}
                disabled={loading}
                className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
              >
                {loading ? "Saving..." : "Continue"}
              </Button>
            </div>
          </form>

          <Dialog open={skipDialogOpen} onOpenChange={setSkipDialogOpen}>
            <DialogTrigger asChild>
              <Button className="w-full" variant="ghost">
                Skip this step
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-900 border-zinc-700">
              <DialogHeader>
                <DialogTitle className="text-white">Are you sure?</DialogTitle>
                <DialogDescription className="text-gray-400">
                  You can register agents later from the dashboard.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setSkipDialogOpen(false)}
                  className="border-zinc-700"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setSkipDialogOpen(false);
                    onSubmit({ action: "skip" });
                  }}
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                >
                  Continue
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </LeftPanel>
      <RightPanel>
        <GeometricPattern icon={<Bot className="size-8 text-violet-400/80" />} />
      </RightPanel>
    </OnboardingStepLayout>
  );
}

// ── Step 3: Genesis ──────────────────────────────────────────────────────────

const GENESIS_OPTIONS = [
  {
    value: "minimal",
    label: "Minimal (3 docs)",
    description: "Architecture overview, code patterns, decisions log",
  },
  {
    value: "standard",
    label: "Standard (5 docs)",
    description: "Above + API contracts, project brief",
  },
  {
    value: "comprehensive",
    label: "Comprehensive (11 docs)",
    description: "Full documentation suite",
  },
  {
    value: "skip",
    label: "Skip",
    description: "I'll set up docs later",
  },
];

function StepGenesis({
  onSubmit,
  goBack,
  currentStep,
  totalSteps,
  loading,
}: StepComponentProps) {
  const [genesisDepth, setGenesisDepth] = useState("standard");

  return (
    <OnboardingStepLayout>
      <LeftPanel
        title="Initialize project knowledge"
        description="Quoth can bootstrap your project's documentation automatically using Genesis."
        currentStep={currentStep}
        totalSteps={totalSteps}
        goBack={goBack}
      >
        <div className="space-y-6 py-4">
          <div className="space-y-3">
            {GENESIS_OPTIONS.map((opt) => (
              <div
                key={opt.value}
                role="button"
                onClick={() => setGenesisDepth(opt.value)}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors",
                  opt.value === genesisDepth
                    ? "border-violet-500 bg-violet-500/10 text-white"
                    : "border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/50 text-gray-300",
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 size-4 shrink-0 rounded-full border-2 flex items-center justify-center",
                    opt.value === genesisDepth
                      ? "border-violet-500 bg-violet-500"
                      : "border-zinc-600",
                  )}
                >
                  {opt.value === genesisDepth && (
                    <Check className="size-2.5 text-white" />
                  )}
                </div>
                <div>
                  <p className="font-medium">{opt.label}</p>
                  <p className="text-xs text-gray-500">{opt.description}</p>
                </div>
              </div>
            ))}
          </div>

          <Button
            onClick={() => onSubmit({ genesisDepth })}
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white"
          >
            {loading ? "Saving..." : "Continue"}
          </Button>
        </div>
      </LeftPanel>
      <RightPanel>
        <GeometricPattern icon={<FileText className="size-8 text-violet-400/80" />} />
      </RightPanel>
    </OnboardingStepLayout>
  );
}

// ── Step 4: Done ─────────────────────────────────────────────────────────────

function StepDone({
  onSubmit,
  goBack,
  currentStep,
  totalSteps,
  loading,
  savedData,
}: StepComponentProps) {
  const docSections = [
    { title: "Quick Start", href: "/docs/getting-started/quick-start" },
    { title: "Installation", href: "/docs/getting-started/installation" },
    { title: "Genesis Guide", href: "/docs/guides/genesis" },
    { title: "Personas", href: "/docs/guides/personas" },
    { title: "MCP Tools Reference", href: "/docs/reference/mcp-tools" },
    { title: "Dashboard Overview", href: "/docs/dashboard/overview" },
  ];

  const [copied, setCopied] = useState(false);
  const mcpCommand = "claude mcp add --transport http quoth https://quoth.triqual.dev/api/mcp";

  const handleCopy = () => {
    navigator.clipboard.writeText(mcpCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <OnboardingStepLayout>
      <LeftPanel
        title="You're all set!"
        description="Your workspace is ready. Here's how to get started:"
        currentStep={currentStep}
        totalSteps={totalSteps}
        goBack={goBack}
      >
        <div className="flex h-full flex-col justify-between gap-6">
          <div className="space-y-4">
            {/* Summary */}
            <div className="space-y-2 rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-3">
              {savedData.orgId && (
                <div className="flex items-center gap-2 text-sm">
                  <Check className="size-3.5 text-emerald-400" />
                  <span className="text-gray-400">Organization created</span>
                </div>
              )}
              {(() => {
                const projectCount = savedData.projectIds
                  ? JSON.parse(savedData.projectIds).length
                  : savedData.projectId ? 1 : 0;
                return projectCount > 0 ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Check className="size-3.5 text-emerald-400" />
                    <span className="text-gray-400">
                      {projectCount} {projectCount === 1 ? "project" : "projects"} created
                    </span>
                  </div>
                ) : null;
              })()}
              {(() => {
                const agentCount = savedData.agentIds
                  ? JSON.parse(savedData.agentIds).length
                  : savedData.agentId ? 1 : 0;
                return agentCount > 0 ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Check className="size-3.5 text-emerald-400" />
                    <span className="text-gray-400">
                      {agentCount} {agentCount === 1 ? "agent" : "agents"} registered
                    </span>
                  </div>
                ) : null;
              })()}
            </div>

            {/* Expandable Next Steps */}
            <Accordion type="multiple" className="space-y-2">
              {/* MCP Install */}
              <AccordionItem value="mcp" className="rounded-lg border border-zinc-700/40 bg-zinc-800/20 px-4">
                <AccordionTrigger className="py-3 text-sm font-medium text-gray-200 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-violet-400" />
                    Connect via MCP
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4 space-y-3">
                  <p className="text-xs text-gray-400">Run this in your terminal to connect Claude Code:</p>
                  <div className="relative group">
                    <pre className="rounded-md bg-zinc-900 border border-zinc-700/50 p-3 text-xs text-gray-300 font-mono overflow-x-auto">
                      {mcpCommand}
                    </pre>
                    <button
                      onClick={handleCopy}
                      className="absolute top-2 right-2 px-2 py-1 text-[10px] rounded bg-zinc-700/80 text-gray-300 hover:bg-violet-600 hover:text-white transition-colors"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">Then restart Claude Code to activate the 18 MCP tools.</p>
                </AccordionContent>
              </AccordionItem>

              {/* Plugin Install */}
              <AccordionItem value="plugin" className="rounded-lg border border-zinc-700/40 bg-zinc-800/20 px-4">
                <AccordionTrigger className="py-3 text-sm font-medium text-gray-200 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Layers className="size-4 text-violet-400" />
                    Install Plugin
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4 space-y-3">
                  <p className="text-xs text-gray-400">Install the Quoth plugin for auto-memory and session hooks:</p>
                  <pre className="rounded-md bg-zinc-900 border border-zinc-700/50 p-3 text-xs text-gray-300 font-mono">
                    /plugin install quoth@quoth-marketplace
                  </pre>
                  <p className="text-xs text-gray-500">Then run <code className="text-violet-400">/quoth-init</code> in your project to configure local memory.</p>
                </AccordionContent>
              </AccordionItem>

              {/* Docs */}
              <AccordionItem value="docs" className="rounded-lg border border-zinc-700/40 bg-zinc-800/20 px-4">
                <AccordionTrigger className="py-3 text-sm font-medium text-gray-200 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-violet-400" />
                    Read Docs
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="space-y-1">
                    {docSections.map((doc) => (
                      <a
                        key={doc.href}
                        href={doc.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-zinc-700/30 transition-colors"
                      >
                        <ChevronRight className="size-3 text-violet-400/60" />
                        {doc.title}
                      </a>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Dashboard */}
              <AccordionItem value="dashboard" className="rounded-lg border border-zinc-700/40 bg-zinc-800/20 px-4">
                <AccordionTrigger className="py-3 text-sm font-medium text-gray-200 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Bot className="size-4 text-violet-400" />
                    Explore Dashboard
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <p className="text-xs text-gray-400">
                    Your dashboard includes agent management, knowledge base search, proposals review, analytics, and API key management.
                  </p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          <Button
            onClick={() => onSubmit({})}
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white"
          >
            {loading ? "Finishing..." : "Go to Dashboard"}
            <Rocket className="ml-1 size-4" />
          </Button>
        </div>
      </LeftPanel>
      <RightPanel className="bg-gradient-to-b from-transparent to-violet-600/5">
        <GeometricPattern icon={<Sparkles className="size-10 text-violet-400/80" />} />
      </RightPanel>
    </OnboardingStepLayout>
  );
}

// ── Main Flow ────────────────────────────────────────────────────────────────

const STEPS = [StepOrganization, StepProject, StepAgent, StepGenesis, StepDone];

export function OnboardingFlow({ initialStep, initialData }: OnboardingFlowProps) {
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [loading, setLoading] = useState(false);
  const [savedData, setSavedData] = useState<Record<string, string>>(initialData);
  const [createdProjects, setCreatedProjects] = useState<CreatedProject[]>([]);
  const [createdAgents, setCreatedAgents] = useState<CreatedAgent[]>([]);
  const router = useRouter();
  const { error: showError } = useToast();

  const handleSubmit = useCallback(
    async (data: Record<string, unknown>) => {
      setLoading(true);
      try {
        const res = await fetch("/api/v1/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: currentStep, data }),
        });

        const json = await res.json();

        if (!res.ok) {
          showError(json.error || "Something went wrong");
          return;
        }

        const newData = json.data ?? {};
        // Serialize arrays for savedData (used in StepDone summary)
        const flatData: Record<string, string> = {};
        for (const [k, v] of Object.entries(newData)) {
          flatData[k] = Array.isArray(v) ? JSON.stringify(v) : String(v ?? "");
        }
        setSavedData((prev) => ({ ...prev, ...flatData }));

        // Step 4 (Done) -> redirect to dashboard
        if (currentStep === 4) {
          router.push("/dashboard");
          return;
        }

        setCurrentStep(json.step);
      } catch {
        showError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [currentStep, router, showError],
  );

  const handleGoBack = useCallback(() => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  }, [currentStep]);

  const StepComponent = STEPS[currentStep] ?? STEPS[0];

  return (
    <section className="min-h-screen bg-gradient-to-b from-[#0a0a0a] via-[#0d0d12] to-[#0a0a0a] py-12 md:py-20 relative overflow-hidden">
      {/* Background texture */}
      <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" />
      <div className="absolute top-0 left-1/3 w-[500px] h-[500px] bg-violet-600/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-violet-900/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="container relative z-10 flex flex-col items-center gap-10 md:gap-14">
        <Logo size="lg" />

        {/* Step indicator dots */}
        <div className="flex items-center gap-2">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === currentStep
                  ? "w-8 bg-violet-500"
                  : i < currentStep
                    ? "w-1.5 bg-violet-500/50"
                    : "w-1.5 bg-zinc-700",
              )}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="w-full"
          >
            <StepComponent
              onSubmit={handleSubmit}
              goBack={currentStep > 0 ? handleGoBack : undefined}
              currentStep={currentStep}
              totalSteps={STEPS.length}
              loading={loading}
              savedData={savedData}
              createdProjects={createdProjects}
              setCreatedProjects={setCreatedProjects}
              createdAgents={createdAgents}
              setCreatedAgents={setCreatedAgents}
            />
          </motion.div>
        </AnimatePresence>

        <div className="flex items-center gap-4 text-xs text-gray-600">
          <p>Quoth Labs</p>
          <a href="/docs" className="underline hover:text-gray-400">
            Docs
          </a>
          <a href="/terms" className="underline hover:text-gray-400">
            Terms
          </a>
        </div>
      </div>
    </section>
  );
}
