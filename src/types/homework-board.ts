export type BoardHomework = {
  id: string;
  content: string;
  text: string;
  tags: string[];
  expired?: boolean;
  expiredMarkColor?: string;
};

export type SubjectGroup = {
  id: string;
  name: string;
  homeworks: BoardHomework[];
};
