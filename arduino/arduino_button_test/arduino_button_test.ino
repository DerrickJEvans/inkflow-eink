#define PIN_PREV   2
#define PIN_NEXT   3
#define PIN_DIAG   A1
#define PIN_AP     A2

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println(F("--- InkFlow Arduino R4 Button Test ---"));

  pinMode(PIN_PREV, INPUT_PULLUP);
  pinMode(PIN_NEXT, INPUT_PULLUP);
  pinMode(PIN_DIAG, INPUT_PULLUP);
  pinMode(PIN_AP,   INPUT_PULLUP);
}

void loop() {
  int prev = digitalRead(PIN_PREV);
  int next = digitalRead(PIN_NEXT);
  int diag = digitalRead(PIN_DIAG);
  int ap   = digitalRead(PIN_AP);

  Serial.print(F("PREV (D2): ")); Serial.print(prev);
  Serial.print(F(" | NEXT (D3): ")); Serial.print(next);
  Serial.print(F(" | DIAG (A1): ")); Serial.print(diag);
  Serial.print(F(" | AP (A2): ")); Serial.println(ap);

  delay(250);
}
