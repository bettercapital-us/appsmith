import React, { useState } from "react";
import styled from "styled-components";
import { Size } from "components/ads/Button";
import { StyledDialog, ForkButton, ButtonWrapper } from "./ForkModalStyles";
import Checkbox from "components/ads/Checkbox";
import { useSelector } from "store";
import { AppState } from "reducers";
import Text, { TextType } from "components/ads/Text";
import { downloadSaga } from "sagas/ActionExecutionSagas";
import { EventType } from "constants/AppsmithActionConstants/ActionConstants";

const CheckboxDiv = styled.div`
  overflow: auto;
  max-height: 250px;
  margin-bottom: 10px;
  margin-top: 20px;
`;

type ExportApplicationModalProps = {
  import?: (file: any) => void;
  export?: (applicationId: string) => void;
  applicationId?: string;
  organizationId?: string;
  isModalOpen?: boolean;
  onClose?: () => void;
  setModalClose?: (isOpen: boolean) => void;
};

function ExportApplicationModal(props: ExportApplicationModalProps) {
  const { setModalClose, isModalOpen } = props;
  const { onClose } = props;
  const exportApplication = () => {
    props.export && props.applicationId && props.export(props.applicationId);
  };
  const importApplication = () => {
    props.organizationId && props.import && props.import("");
    onClose && onClose();
  };
  const exportingApplication = useSelector(
    (state: AppState) => state.ui.applications.exportingApplication,
  );
  const exportedApplication = useSelector(
    (state: AppState) => state.ui.applications.exportedApplication,
  );

  const downloadExportedApplication = async () => {
    await downloadSaga(
      {
        data: exportedApplication,
        name: "exportedApplication.json",
        type: "text/plain",
      },
      { type: EventType.ON_SUBMIT },
    );
    setModalClose && setModalClose(false);
  };

  const [isChecked, setIsCheckedToTrue] = useState(false);
  return (
    <StyledDialog
      canOutsideClickClose
      className={"fork-modal"}
      isOpen={isModalOpen}
      maxHeight={"540px"}
      setModalClose={setModalClose}
      title={
        !!exportedApplication
          ? "Your application is ready for download!"
          : "Be sure to read the data policy"
      }
    >
      {!exportedApplication && (
        <CheckboxDiv>
          <Text type={TextType.P1}>
            <Checkbox
              label="By clicking on this you agree that your application credentials can be stored inside a file"
              onCheckChange={(checked: boolean) => {
                setIsCheckedToTrue(checked);
              }}
            />
          </Text>
        </CheckboxDiv>
      )}
      {props.import && (
        <ButtonWrapper>
          <ForkButton
            cypressSelector={"t--import-app-button"}
            disabled={!isChecked}
            onClick={importApplication}
            size={Size.large}
            text={"IMPORT"}
          />
        </ButtonWrapper>
      )}
      {props.export && (
        <ButtonWrapper>
          <ForkButton
            cypressSelector={"t--export-app-button"}
            disabled={!isChecked}
            isLoading={exportingApplication}
            onClick={
              !!exportedApplication
                ? downloadExportedApplication
                : exportApplication
            }
            size={Size.large}
            text={!!exportedApplication ? "Download" : "EXPORT"}
          />
        </ButtonWrapper>
      )}
    </StyledDialog>
  );
}

export default ExportApplicationModal;
