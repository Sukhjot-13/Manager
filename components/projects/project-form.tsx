"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { LINK_TYPES, PROJECT_STATUSES } from "@/lib/db/projects";
import type { ProjectSummary } from "@/lib/projects";

type LinkDraft = { type: string; url: string; label: string };

export function ProjectForm({
  project,
  trigger = "button",
}: {
  project?: ProjectSummary;
  trigger?: "button" | "inline";
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(project?.name ?? "");
  const [slug, setSlug] = useState(project?.slug ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState(project?.status ?? "idea");
  const [tags, setTags] = useState((project?.tags ?? []).join(", "));
  const [emoji, setEmoji] = useState(project?.emoji ?? "📁");
  const [color, setColor] = useState(project?.color ?? "#6366f1");
  const [githubRepo, setGithubRepo] = useState(project?.githubRepo ?? "");
  const [notesMd, setNotesMd] = useState(project?.notesMd ?? "");
  const [links, setLinks] = useState<LinkDraft[]>(
    project?.links.map((link) => ({ ...link })) ?? [],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const payload = {
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim(),
      status,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ""),
      emoji,
      color,
      githubRepo: githubRepo.trim(),
      notesMd,
      links: links
        .filter((link) => link.url.trim() !== "")
        .map((link) => ({
          type: link.type,
          url: link.url.trim(),
          label: link.label.trim(),
        })),
    };
    const response = await fetch(
      project === undefined ? "/api/projects" : `/api/projects/${project.slug}`,
      {
        method: project === undefined ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    setPending(false);
    if (response.ok) {
      const body = (await response.json()) as { project: ProjectSummary };
      setOpen(false);
      push(project === undefined ? "Project created" : "Project updated", "success");
      router.push(`/projects/${body.project.slug}`);
      router.refresh();
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setError(
      body.error === "internal_error"
        ? "Slug already in use"
        : "Check the form and try again",
    );
  }

  const fields = (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="project-name">
          <Input
            id="project-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Slug" htmlFor="project-slug" hint="Leave blank to auto-generate">
          <Input
            id="project-slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
          />
        </Field>
        <Field label="Status" htmlFor="project-status">
          <Select
            id="project-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {PROJECT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tags" htmlFor="project-tags" hint="Comma separated tech stack">
          <Input
            id="project-tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </Field>
        <Field label="Emoji" htmlFor="project-emoji">
          <Input
            id="project-emoji"
            value={emoji}
            onChange={(event) => setEmoji(event.target.value)}
          />
        </Field>
        <Field label="Color" htmlFor="project-color">
          <Input
            id="project-color"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Description" htmlFor="project-description">
        <Textarea
          id="project-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <Field
        label="GitHub repository"
        htmlFor="project-github"
        hint="owner/repo or a full URL — used for stars, issues and last push"
      >
        <Input
          id="project-github"
          value={githubRepo}
          onChange={(event) => setGithubRepo(event.target.value)}
          placeholder="Sukhjot-13/Manager"
        />
      </Field>
      <div>
        <Label2>Links</Label2>
        <div className="space-y-2">
          {links.map((link, index) => (
            <div key={index} className="flex gap-2">
              <Select
                value={link.type}
                onChange={(event) =>
                  setLinks((current) =>
                    current.map((entry, position) =>
                      position === index ? { ...entry, type: event.target.value } : entry,
                    ),
                  )
                }
                className="w-28"
              >
                {LINK_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
              <Input
                value={link.url}
                placeholder="https://"
                onChange={(event) =>
                  setLinks((current) =>
                    current.map((entry, position) =>
                      position === index ? { ...entry, url: event.target.value } : entry,
                    ),
                  )
                }
              />
              <Input
                value={link.label}
                placeholder="label"
                className="w-32"
                onChange={(event) =>
                  setLinks((current) =>
                    current.map((entry, position) =>
                      position === index ? { ...entry, label: event.target.value } : entry,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setLinks((current) => current.filter((_, position) => position !== index))
                }
                aria-label="Remove link"
              >
                ×
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setLinks((current) => [...current, { type: "github", url: "", label: "" }])
            }
          >
            <Plus size={12} />
            Add link
          </Button>
        </div>
      </div>
      <Field label="Notes" htmlFor="project-notes" hint="Markdown — changelog, reminders, TODOs">
        <Textarea
          id="project-notes"
          className="min-h-40 font-mono text-xs"
          value={notesMd}
          onChange={(event) => setNotesMd(event.target.value)}
        />
      </Field>
      {error !== "" ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : project === undefined ? "Create project" : "Save changes"}
        </Button>
      </div>
    </form>
  );

  if (trigger === "inline") {
    return fields;
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} variant={project === undefined ? "primary" : "outline"}>
        <Plus size={14} />
        {project === undefined ? "New project" : "Edit"}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={project === undefined ? "New project" : `Edit ${project.name}`}
        wide
      >
        {fields}
      </Dialog>
    </>
  );
}

function Label2({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
      {children}
    </span>
  );
}
