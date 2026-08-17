import { Card } from "@/components/ui/card";
import { FileQuestion } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-[80vh] w-full flex items-center justify-center">
      <Card className="w-full max-w-md p-8 text-center bg-card shadow-lg border-none">
        <div className="flex justify-center mb-6 text-primary">
          <div className="p-4 bg-primary/10 rounded-full">
            <FileQuestion className="w-12 h-12" />
          </div>
        </div>
        <h1 className="text-3xl font-display font-bold text-foreground mb-3">Page Not Found</h1>
        <p className="text-muted-foreground mb-8 text-base">
          We couldn't find the page you're looking for. It might have been moved or doesn't exist.
        </p>
        <Link href="/" className="block">
          <Button size="lg" className="w-full text-lg rounded-xl h-14">
            Return to Dashboard
          </Button>
        </Link>
      </Card>
    </div>
  );
}