"use client";

/** Checks every payment method of its form; the user still saves with "Guardar medios de pago". */
export function SelectAllButton() {
  return (
    <button
      type="button"
      className="link-button select-all"
      onClick={(event) => {
        for (const input of event.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="method"]') ?? []) input.checked = true;
      }}
    >
      Seleccionar todos los medios de pago
    </button>
  );
}
