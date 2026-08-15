import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { SignIn, SignUp } from "@clerk/clerk-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/providers/trpc";
import { createSupabaseClient } from "@/lib/supabase";
import { setSessionToken } from "@/lib/session-token";
import { OpenInTabButton } from "@/components/OpenInTabButton";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;

type Mode = "signin" | "signup";

export default function Login() {
  const [searchParams] = useSearchParams();
  const { data: config } = trpc.auth.config.useQuery(undefined, {
    staleTime: Infinity,
  });

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const login = trpc.auth.login.useMutation();
  const register = trpc.auth.register.useMutation();
  const supabaseLogin = trpc.auth.supabaseLogin.useMutation();
  const resetPassword = trpc.auth.resetPassword.useMutation();

  const supabase = useMemo(() => {
    if (config?.mode === "supabase" && config.supabaseUrl && config.supabaseAnonKey) {
      return createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey);
    }
    return null;
  }, [config]);

  const kimiState = config?.kimiStatus ?? "not_connected";
  const kimiLabel =
    kimiState === "real"
      ? "Kimi connected — AI features enabled."
      : kimiState === "mock"
        ? "Running with mock Kimi responses (no API keys needed)."
        : "Kimi not connected — core monitoring works without it.";

  function resetFeedback() {
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    resetFeedback();

    if (mode === "signup") {
      if (supabase) {
        const { data, error: supErr } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name || undefined } },
        });
        if (supErr) return setError(supErr.message);
        if (data.session) {
          return supabaseLogin.mutate(
            { accessToken: data.session.access_token },
            {
              onError: (err) => setError(err.message),
              onSuccess: (res) => {
                setSessionToken(res.token);
                window.location.href = "/";
              },
            },
          );
        }
        return setNotice(
          "Account created. Check your email to confirm, then sign in.",
        );
      }
      register.mutate(
        { email, password, name: name || undefined },
        {
          onError: (err) => setError(err.message),
          onSuccess: (res) => {
            setSessionToken(res.token);
            window.location.href = "/";
          },
        },
      );
      return;
    }

    // signin
    if (supabase) {
      const { data, error: supErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (supErr) return setError(supErr.message);
      return supabaseLogin.mutate(
        { accessToken: data.session.access_token },
        {
          onError: (err) => setError(err.message),
          onSuccess: (res) => {
            setSessionToken(res.token);
            window.location.href = "/";
          },
        },
      );
    }
    login.mutate(
      { email, password },
      {
        onError: (err) => setError(err.message),
        onSuccess: (res) => {
          setSessionToken(res.token);
          window.location.href = "/";
        },
      },
    );
  }

  function handleForgotPassword() {
    resetFeedback();
    if (!supabase) {
      return setNotice(
        "Password reset is only available when Supabase is configured. In local demo mode, create a new account or use the demo account.",
      );
    }
    if (!email) return setError("Enter your email first.");
    resetPassword.mutate(
      { email },
      {
        onError: (err) => setError(err.message),
        onSuccess: () =>
          setNotice("If that email exists, a reset link has been sent."),
      },
    );
  }

  function fillDemo() {
    resetFeedback();
    if (!config?.demoCredentials) return;
    setMode("signin");
    setEmail(config.demoCredentials.email);
    setPassword(config.demoCredentials.password);
  }

  const pending =
    login.isPending ||
    register.isPending ||
    supabaseLogin.isPending ||
    resetPassword.isPending;

  if (config?.mode === "clerk") {
    if (!clerkPublishableKey) {
      return (
        <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Clerk is almost configured</CardTitle>
              <CardDescription>
                Add VITE_CLERK_PUBLISHABLE_KEY in the Keys tab, then reload this page.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      );
    }

    const isSignUp = searchParams.get("mode") === "signup";
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
        {isSignUp ? (
          <SignUp
            routing="hash"
            signInUrl="/login"
            fallbackRedirectUrl="/"
          />
        ) : (
          <SignIn
            routing="hash"
            signUpUrl="/login?mode=signup"
            fallbackRedirectUrl="/"
          />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-1">
          <CardTitle className="text-2xl">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </CardTitle>
          <CardDescription>
            {mode === "signin"
              ? "Sign in to your API monitoring dashboard."
              : "Start monitoring your APIs in minutes."}
          </CardDescription>
          <div className="flex justify-center pt-2">
            <OpenInTabButton />
          </div>
        </CardHeader>

        <CardContent>
          <div className="mb-4 text-xs text-muted-foreground rounded-lg bg-muted/50 px-3 py-2">
            {kimiLabel} AI analysis is optional.
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="Ada Lovelace"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={mode === "signup" ? 8 : 1}
                placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="text-sm text-muted-foreground" role="status">
                {notice}
              </p>
            )}

            <Button type="submit" className="w-full" size="lg" disabled={pending}>
              {pending
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>

          {config?.demoCredentials && (
            <Button
              variant="outline"
              className="w-full mt-3"
              onClick={fillDemo}
              type="button"
            >
              Use demo account ({config.demoCredentials.email})
            </Button>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              resetFeedback();
              setMode((m) => (m === "signin" ? "signup" : "signin"));
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {mode === "signin"
              ? "Don't have an account? Create one"
              : "Already have an account? Sign in"}
          </button>
          <div className="flex items-center justify-between w-full text-sm">
            <button
              type="button"
              onClick={handleForgotPassword}
              className="text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </button>
            <Link to="/" className="text-muted-foreground hover:text-foreground">
              Back to home
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
