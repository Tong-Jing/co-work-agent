interface PendingApproval {
  resolve(decision: "allow" | "deny"): void;
  runId: string;
}

export class ApprovalService {
  readonly #pending = new Map<string, PendingApproval>();

  wait(callId: string, runId: string, signal: AbortSignal) {
    return new Promise<"allow" | "deny">((resolve, reject) => {
      const onAbort = () => {
        this.#pending.delete(callId);
        reject(signal.reason ?? new Error("Run cancelled"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(callId, {
        runId,
        resolve: (decision) => {
          signal.removeEventListener("abort", onAbort);
          this.#pending.delete(callId);
          resolve(decision);
        },
      });
    });
  }

  decide(callId: string, decision: "allow" | "deny") {
    const pending = this.#pending.get(callId);
    if (!pending) return false;
    pending.resolve(decision);
    return true;
  }
}
