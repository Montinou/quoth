"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
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
import { Logo } from "@/components/quoth/Logo";
import { useToast } from "@/contexts/ToastContext";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

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
    <div className="flex w-full flex-col-reverse gap-10 rounded-2xl border border-zinc-800 bg-zinc-900/80 backdrop-blur-xl md:min-h-[85dvh] md:flex-row">
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
    <div className="flex flex-1/2 justify-center pr-10 sm:py-10 sm:pb-10 sm:pl-10 md:py-20 lg:justify-start lg:pr-0 lg:pl-24">
      <div className="flex h-full w-full max-w-sm shrink-0 flex-col gap-6 md:max-w-md">
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
        "hidden flex-1/2 overflow-hidden sm:pt-10 md:pt-20 lg:flex items-center justify-center",
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

// ── Dashboard Illustration (dark themed) ─────────────────────────────────────

function DashboardIllustration({
  title = "Quoth",
  icon,
}: {
  title?: string;
  icon?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex h-80 w-full max-w-md overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-800/30"
    >
      <div className="h-full w-1/3 shrink-0 overflow-hidden bg-zinc-800/60 border-r border-zinc-700/50">
        <div className="flex items-center gap-2 border-b border-zinc-700/50 p-4">
          <div className="size-7 shrink-0 rounded-md bg-violet-600/30 flex items-center justify-center">
            {icon ?? <Sparkles className="size-3.5 text-violet-400" />}
          </div>
          <p className="truncate text-sm font-semibold text-gray-300">
            {title}
          </p>
        </div>
        <ul className="space-y-2 p-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <li
              key={`sb-${i}`}
              className="h-7 rounded-lg border border-zinc-700/30 bg-zinc-800/40"
            />
          ))}
        </ul>
      </div>
      <div className="flex flex-1 flex-col justify-between p-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg border border-zinc-700/40 bg-zinc-800/40" />
            <div className="h-8 w-40 rounded-lg border border-zinc-700/40 bg-zinc-800/40" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={`row-${i}`}
              className="h-8 rounded-lg border border-zinc-700/20 bg-zinc-800/20"
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={`btn-${i}`}
              className="size-7 rounded-lg border border-zinc-700/30 bg-zinc-800/40"
            />
          ))}
        </div>
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
        <DashboardIllustration icon={<Layers className="size-3.5 text-violet-400" />} />
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
}: StepComponentProps) {
  const [projectName, setProjectName] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [description, setDescription] = useState("");
  const [slugManual, setSlugManual] = useState(false);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setProjectName(val);
    if (!slugManual) setProjectSlug(slugify(val));
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlugManual(true);
    setProjectSlug(slugify(e.target.value));
  };

  return (
    <OnboardingStepLayout>
      <LeftPanel
        title="Create your first project"
        description="Projects group documents, agents, and search indexes."
        currentStep={currentStep}
        totalSteps={totalSteps}
        goBack={goBack}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ projectName, projectSlug, description });
          }}
          className="space-y-6 py-4"
        >
          <FormField
            label="Project name"
            placeholder="My App"
            name="projectName"
            value={projectName}
            onChange={handleNameChange}
            disabled={loading}
          />
          <FormField
            label="Project slug"
            placeholder="my-app"
            name="projectSlug"
            value={projectSlug}
            onChange={handleSlugChange}
            disabled={loading}
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
              disabled={loading}
              className="w-full bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-violet-500"
              style={{ resize: "none" }}
            />
          </div>
          <Button
            type="submit"
            disabled={loading || !projectName.trim()}
            className="mt-4 w-full bg-violet-600 hover:bg-violet-700 text-white"
          >
            {loading ? "Creating..." : "Continue"}
          </Button>
        </form>
      </LeftPanel>
      <RightPanel>
        <DashboardIllustration
          title={projectName || "Your Project"}
          icon={<Layers className="size-3.5 text-violet-400" />}
        />
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
}: StepComponentProps) {
  const [agentName, setAgentName] = useState("claude");
  const [displayName, setDisplayName] = useState("Claude");
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [role, setRole] = useState("orchestrator");
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);

  return (
    <OnboardingStepLayout>
      <LeftPanel
        title="Register your AI agent"
        description="Connect an AI agent to your project for documentation and search."
        currentStep={currentStep}
        totalSteps={totalSteps}
        goBack={goBack}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ agentName: slugify(agentName), displayName, model, role });
          }}
          className="space-y-5 py-4"
        >
          <FormField
            label="Agent name"
            placeholder="claude"
            name="agentName"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            disabled={loading}
          />
          <FormField
            label="Display name"
            placeholder="Claude"
            name="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={loading}
          />

          <div className="space-y-2">
            <Label className="text-gray-300">Model</Label>
            <Select value={model} onValueChange={setModel} disabled={loading}>
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
            <Select value={role} onValueChange={setRole} disabled={loading}>
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

          <Button
            type="submit"
            disabled={loading || !agentName.trim()}
            className="mt-4 w-full bg-violet-600 hover:bg-violet-700 text-white"
          >
            {loading ? "Registering..." : "Continue"}
          </Button>

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
                    onSubmit({ skip: true });
                  }}
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                >
                  Continue
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </form>
      </LeftPanel>
      <RightPanel>
        <DashboardIllustration
          title={displayName || "Agent"}
          icon={<Bot className="size-3.5 text-violet-400" />}
        />
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
        <DashboardIllustration
          title="Genesis"
          icon={<FileText className="size-3.5 text-violet-400" />}
        />
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
  const nextSteps = [
    {
      title: "Connect via MCP",
      description: "Set up the MCP server in Claude Code",
    },
    {
      title: "Explore Dashboard",
      description: "View agents, documents, and analytics",
    },
    {
      title: "Read Docs",
      description: "Learn about Quoth's capabilities",
    },
  ];

  return (
    <OnboardingStepLayout>
      <LeftPanel
        title="You're all set!"
        description="Your workspace is ready. Here's a summary:"
        currentStep={currentStep}
        totalSteps={totalSteps}
        goBack={goBack}
      >
        <div className="flex h-full flex-col justify-between gap-8">
          <div className="space-y-6">
            {/* Summary */}
            <div className="space-y-3 rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-4">
              {savedData.orgId && (
                <div className="flex items-center gap-2 text-sm">
                  <Layers className="size-4 text-violet-400" />
                  <span className="text-gray-400">Organization created</span>
                </div>
              )}
              {savedData.projectId && (
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="size-4 text-violet-400" />
                  <span className="text-gray-400">Project created</span>
                </div>
              )}
              {savedData.agentId && (
                <div className="flex items-center gap-2 text-sm">
                  <Bot className="size-4 text-violet-400" />
                  <span className="text-gray-400">Agent registered</span>
                </div>
              )}
            </div>

            {/* Next steps */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-300">Next steps:</p>
              {nextSteps.map((step, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg border border-zinc-700/30 bg-zinc-800/20 px-4 py-3"
                >
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-violet-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-200">
                      {step.title}
                    </p>
                    <p className="text-xs text-gray-500">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
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
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="flex flex-col items-center gap-4"
        >
          <div className="size-24 rounded-2xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
            <Sparkles className="size-12 text-violet-400" />
          </div>
          <p
            className="text-2xl font-medium text-gray-300 italic"
            style={{ fontFamily: "var(--font-cormorant), serif" }}
          >
            Nevermore forget.
          </p>
        </motion.div>
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
        setSavedData((prev) => ({ ...prev, ...newData }));

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
    <section className="min-h-screen bg-[#0a0a0a] py-12 md:py-20">
      <div className="container flex flex-col items-center gap-12 md:gap-16">
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
