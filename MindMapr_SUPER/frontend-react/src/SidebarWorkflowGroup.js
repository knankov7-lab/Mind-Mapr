import React from "react";

export default function SidebarWorkflowGroup({ title, description, children }) {
  return (
    <section className="workflowGroup" aria-label={title}>
      <header className="workflowGroupHeader">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="workflowGroupBody">{children}</div>
    </section>
  );
}
