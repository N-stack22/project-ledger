import { useEffect, useRef } from "react";
import { Bold, Italic, List, ListOrdered, Pilcrow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const toolbar = [
  { icon: Bold, command: "bold", label: "Negrita" },
  { icon: Italic, command: "italic", label: "Cursiva" },
  { icon: List, command: "insertUnorderedList", label: "Lista" },
  { icon: ListOrdered, command: "insertOrderedList", label: "Lista numerada" },
  { icon: Pilcrow, command: "formatBlock", value: "p", label: "Párrafo" },
] as const;

export function RichTextEditor({ value, onChange, className }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || "<p></p>";
    }
  }, [value]);

  const applyCommand = (command: string, commandValue?: string) => {
    document.execCommand(command, false, commandValue);
    onChange(editorRef.current?.innerHTML || "");
  };

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/40 p-2">
        {toolbar.map((item) => (
          <Button
            key={item.label}
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onMouseDown={(event) => {
              event.preventDefault();
              applyCommand(item.command, item.value);
            }}
          >
            <item.icon className="h-4 w-4" />
            <span className="sr-only">{item.label}</span>
          </Button>
        ))}
      </div>
      <div
        ref={editorRef}
        className="min-h-52 w-full px-4 py-3 text-sm leading-6 text-foreground outline-none [&_li]:ml-4 [&_p]:mb-3"
        contentEditable
        suppressContentEditableWarning
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
      />
    </div>
  );
}
