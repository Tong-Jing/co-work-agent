import { useEffect, useRef, useState } from "react";

interface CreateWorkspaceDialogProps {
  open: boolean;
  pending: boolean;
  error: string | null;
  onClose(): void;
  onSubmit(name: string): void;
}

export function CreateWorkspaceDialog({ open, pending, error, onClose, onSubmit }: CreateWorkspaceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setName("");
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const trimmedName = name.trim();

  return (
    <dialog ref={dialogRef} className="workspace-dialog" onCancel={onClose} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmedName && !pending) onSubmit(trimmedName);
        }}
      >
        <header>
          <h2>New workspace</h2>
        </header>
        <label>
          Workspace name
          <input
            autoFocus
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Frontend"
          />
        </label>
        {error && <div className="dialog-error">{error}</div>}
        <footer>
          <button type="button" className="secondary" disabled={pending} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!trimmedName || pending}>{pending ? "Creating…" : "Create"}</button>
        </footer>
      </form>
    </dialog>
  );
}