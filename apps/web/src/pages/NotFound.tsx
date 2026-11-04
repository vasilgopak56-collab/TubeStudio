import { Link } from "react-router-dom";
import { Button } from "@/components/ui";
export default function NotFound() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <div className="font-mono text-6xl font-bold text-primary">404</div>
      <p className="mt-3 text-muted-foreground">Такой страницы нет.</p>
      <Link to="/" className="mt-6"><Button>На панель</Button></Link>
    </div>
  );
}
