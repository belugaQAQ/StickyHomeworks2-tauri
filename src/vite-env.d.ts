/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}


declare module "typewriter-effect/dist/core" {
  type TypewriterOptions = {
    delay?: number;
    deleteSpeed?: number;
    cursor?: string;
  };
  type TypewriterInstance = {
    deleteAll(speed?: number): TypewriterInstance;
    typeString(text: string): TypewriterInstance;
    start(): TypewriterInstance;
    stop(): TypewriterInstance;
  };
  const Typewriter: new (element: HTMLElement, options?: TypewriterOptions) => TypewriterInstance;
  export default Typewriter;
}