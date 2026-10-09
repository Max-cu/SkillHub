import SkillHub from './skillhub';
import AuthGate from './auth-gate';
export default function Home() { return <AuthGate><SkillHub /></AuthGate>; }
