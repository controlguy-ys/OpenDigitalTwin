# CRB 15000 RobotSim Web

## Robot geometry and kinematics

The authoritative source geometry is the supplied
`CRB15000_12kg-127_OmniCore_rev00_STEP_J` STEP set. Runtime `LINK00` through
`LINK06` GLBs are generated from those files with OCCT metre output and retain
the source mesh and face colors.

The numeric CRB 15000-12/1.27 joint origins and axes are attributed to the
ROS-Industrial `abb_crb15000_support/urdf/crb15000_12_127_macro.xacro`
definition. Joint limits were cross-checked against ABB product specification
3HAC077390-001 Revision X.
